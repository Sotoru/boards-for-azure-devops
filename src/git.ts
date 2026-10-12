import * as vscode from 'vscode';
import { getWorkItemFull, listStatesFull, myIdentity, update, WorkItem } from './api';
import { branchName, commitRef, idFromBranch } from './gitText';
import { ScopeStore } from './scope';

const t = vscode.l10n.t;
const config = () => vscode.workspace.getConfiguration('board_azr_devops');

// The subset of the built-in Git extension API (extensions/git/src/api/git.d.ts) used here.
interface Ref { type: number; name?: string; commit?: string; remote?: string }
interface Repository {
  rootUri: vscode.Uri;
  state: { HEAD?: Ref; refs: Ref[]; onDidChange: vscode.Event<void> };
  inputBox: { value: string };
  getRefs?(query: object): Promise<Ref[]>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
  fetch(): Promise<void>;
}
interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  getRepository(uri: vscode.Uri): Repository | null;
}
const HEAD_REF = 0;

async function gitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitAPI }>('vscode.git');
  if (!ext) return;
  return (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
}

/** Tracks the work item of the current branch and handles "Start working". */
export class GitIntegration {
  private api?: GitAPI;
  private readonly changed = new vscode.EventEmitter<WorkItem | undefined>();
  readonly onDidChangeActive = this.changed.event;
  active?: WorkItem;
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  private readonly subs: vscode.Disposable[] = [];
  private watched = new Set<Repository>();

  constructor(private readonly scope: ScopeStore) {
    this.status.command = 'board_azr_devops.openActive';
    void this.init();
  }

  private async init() {
    this.api = await gitApi();
    if (!this.api) return;
    this.api.repositories.forEach(r => this.watch(r));
    this.subs.push(
      this.api.onDidOpenRepository(r => { this.watch(r); void this.update(); }),
      vscode.window.onDidChangeActiveTextEditor(() => void this.update()),
    );
    await this.update();
  }

  private watch(r: Repository) {
    if (this.watched.has(r)) return;
    this.watched.add(r);
    this.subs.push(r.state.onDidChange(() => void this.update()));
  }

  /** With several repos open, the one containing the active editor wins. */
  private repo(): Repository | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return (uri && this.api?.getRepository(uri)) || this.api?.repositories[0];
  }

  async update() {
    const repo = this.repo();
    const id = idFromBranch(repo?.state.HEAD?.name);
    const org = this.scope.current.org;
    if (!id || !org) return this.setActive(undefined);
    if (this.active?.id === id && this.active.org === org) return this.prefill(repo!);
    try {
      const full = await getWorkItemFull({ org, id });
      this.setActive({ org, id, fields: full.fields });
      this.prefill(repo!);
    } catch {
      this.setActive(undefined); // not a work item id in this org (e.g. release/123)
    }
  }

  private setActive(w: WorkItem | undefined) {
    if (w?.id === this.active?.id && w?.org === this.active?.org) return;
    this.active = w;
    if (w) {
      this.status.text = `$(target) #${w.id}`;
      this.status.tooltip = t('Working on #{0} {1} (from the branch name)', w.id, w.fields['System.Title']);
      this.status.show();
    } else this.status.hide();
    this.changed.fire(w);
  }

  /** Puts "#id " in an empty commit message box; never touches a message the user started. */
  private prefill(repo: Repository) {
    if (!this.active || !config().get('commitReference', true)) return;
    if (!repo.inputBox.value.trim()) repo.inputBox.value = `${commitRef(this.active.id)} `;
  }

  async startWork(w: WorkItem) {
    if (!this.api) this.api = await gitApi();
    const repos = this.api?.repositories ?? [];
    if (!repos.length) throw new Error(t('Open a folder with a Git repository to start working on #{0}', w.id));
    const repo = repos.length === 1 ? repos[0] : await vscode.window.showQuickPick(
      repos.map(r => ({ label: vscode.workspace.asRelativePath(r.rootUri), repo: r })), { placeHolder: t('Repository') }).then(p => p?.repo);
    if (!repo) return;

    const name = branchName(config().get('branchTemplate', '{type}/{id}'), w);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Starting work on #{0}', w.id) }, async () => {
      await repo.fetch().catch(() => undefined); // offline or no remote: branch from what we have
      const refs = repo.getRefs ? await repo.getRefs({}) : repo.state.refs;
      if (refs.some(r => r.type === HEAD_REF && r.name === name)) {
        await repo.checkout(name);
      } else {
        // Branch from a commit, not a remote ref, so the new branch doesn't track (and push to) the base branch.
        const baseName = config().get<string>('baseBranch') || undefined;
        const base = refs.find(r => r.name === baseName)
          ?? refs.find(r => r.name === 'origin/HEAD')
          ?? refs.find(r => r.name === 'origin/main')
          ?? refs.find(r => r.name === 'origin/master');
        await repo.createBranch(name, true, base?.commit);
      }
      await this.claim(w);
    });
    await this.update();
    vscode.window.setStatusBarMessage(t('On branch {0}', name), 5000);
  }

  /** Moves a not-yet-started item to the first "in progress" state and assigns it to me. */
  private async claim(w: WorkItem) {
    const [states, me] = await Promise.all([listStatesFull(w), myIdentity(w.org)]);
    const category = states.find(s => s.name === w.fields['System.State'])?.category;
    const inProgress = states.find(s => s.category === 'InProgress')?.name;
    const fields: Parameters<typeof update>[1] = {};
    if (category === 'Proposed' && inProgress) fields['System.State'] = inProgress;
    if (w.fields['System.AssignedTo']?.uniqueName?.toLowerCase() !== me.toLowerCase()) fields['System.AssignedTo'] = me;
    if (Object.keys(fields).length) await update(w, fields);
  }

  dispose() { this.status.dispose(); this.changed.dispose(); this.subs.forEach(s => s.dispose()); }
}
