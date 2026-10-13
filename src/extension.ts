import * as vscode from 'vscode';
import { allowLogin, webUrl, WorkItem } from './api';
import { SCHEME, WorkItemEditorFs } from './editorFs';
import { createInScope, edits } from './edits';
import { copyForAi, registerMcp } from './ai';
import { BoardPanel } from './board';
import { GitIntegration } from './git';
import { clearFilters, pickFilters, pickGroupBy } from './filterPick';
import { activeFilterCount } from './filters';
import { Model } from './model';
import { preview, shownId } from './preview';
import { QueryTree } from './queries';
import { ScopeStore } from './scope';
import { Row, WorkItemTree } from './tree';

const t = vscode.l10n.t;
const config = () => vscode.workspace.getConfiguration('board_azr_devops');

export function activate(ctx: vscode.ExtensionContext) {
  const scope = new ScopeStore(ctx.globalState);
  const model = new Model(ctx.globalState, scope);
  const editorFs = new WorkItemEditorFs();
  const git = new GitIntegration(scope);
  const tree = new WorkItemTree(model, () => git.active?.id);
  const board = new BoardPanel(ctx.extensionUri, ctx.globalState, model, () => git.active?.id);
  const view = vscode.window.createTreeView('board_azr_devops.items', { treeDataProvider: tree, showCollapseAll: true });
  const queries = new QueryTree(model, () => git.active?.id);
  const queryView = vscode.window.createTreeView('board_azr_devops.queries', { treeDataProvider: queries, showCollapseAll: true });
  const safe = <A extends unknown[]>(fn: (...a: A) => unknown) => (...args: A) => {
    allowLogin();
    return Promise.resolve().then(() => fn(...args)).catch(e => vscode.window.showErrorMessage(`Azure Boards: ${(e as Error).message}`));
  };
  const command = (id: string, fn: (...a: any[]) => unknown) => vscode.commands.registerCommand(`board_azr_devops.${id}`, safe(fn));

  const afterChange = async (w: WorkItem) => {
    await model.refresh();
    if (shownId() === w.id) await preview(w);
  };

  const present = () => {
    const { org, team } = scope.current;
    const mode = model.mode;
    const filters = activeFilterCount(model.filters);
    view.title = mode === 'mine' ? t('Assigned to me') : team ?? t('Team');
    view.description = model.loaded ? [
      String(model.visible.length),
      filters ? t('{0} filters', filters) : '',
      mode === 'all' && model.filters.currentSprint ? t('current sprint') : '',
    ].filter(Boolean).join(' · ') : '';
    view.badge = model.mine.length ? { value: model.mine.length, tooltip: t('{0} open work items assigned to you', model.mine.length) } : undefined;
    const set = (key: string, value: unknown) => vscode.commands.executeCommand('setContext', `board_azr_devops.${key}`, value);
    void set('mode', mode);
    void set('noOrg', !org);
    void set('noTeam', mode === 'all' && !team);
    void set('filtered', filters > 0);
    void set('emptyFiltered', model.loaded && filters > 0 && !model.visible.length);
  };

  const notify = (items: WorkItem[]) => {
    if (!config().get('notifyAssigned', true)) return;
    const open = t('Open'), ignore = t('Ignore');
    if (items.length > 3) {
      void vscode.window.showInformationMessage(t('{0} new work items assigned to you', items.length), open, ignore)
        .then(async a => {
          if (a !== open) return;
          await model.setMode('mine');
          await vscode.commands.executeCommand('board_azr_devops.items.focus');
        });
      return;
    }
    for (const w of items) {
      void vscode.window.showInformationMessage(t('Assigned to you: #{0} {1}', w.id, w.fields['System.Title']), open, ignore)
        .then(a => { if (a === open) void preview(w); });
    }
  };

  // Polling only while the window is focused; coming back after a while refreshes right away.
  const minutes = () => Math.max(1, config().get<number>('refreshMinutes', 5));
  const stale = (ms: number) => Date.now() - model.lastRefresh >= ms;
  const timer = setInterval(() => { if (vscode.window.state.focused && stale(minutes() * 60_000)) void model.refresh(); }, 30_000);

  ctx.subscriptions.push(
    scope, view, queryView, git,
    git.onDidChangeActive(() => { tree.refresh(); queries.refresh(); }),
    scope.onDidChange(() => git.update()),
    { dispose: () => clearInterval(timer) },
    model.onDidChange(present),
    model.onNewAssignments(notify),
    scope.onDidChange(() => model.refresh()),
    vscode.window.onDidChangeWindowState(s => { if (s.focused && stale(60_000)) void model.refresh(); }),
    command('refresh', () => model.refresh()),
    command('switchScope', () => scope.pick()),
    command('showAll', () => model.setMode('all')),
    command('showMine', () => model.setMode('mine')),
    command('filter', () => pickFilters(model)),
    command('filterActive', () => pickFilters(model)),
    command('clearFilters', () => clearFilters(model)),
    command('groupBy', () => pickGroupBy(model)),
    command('open', (w: WorkItem) => vscode.env.openExternal(vscode.Uri.parse(webUrl(w)))),
    command('preview', preview),
    command('startWork', async (w: WorkItem) => { await git.startWork(w); await afterChange(w); }),
    command('openBoard', () => board.show()),
    command('copyForAi', copyForAi),
    command('copyField', async (r: Row) => {
      if (!r?.copy) return;
      await vscode.env.clipboard.writeText(r.copy);
      vscode.window.setStatusBarMessage(t('Copied: {0}', r.copy.length > 40 ? `${r.copy.slice(0, 40)}…` : r.copy), 3000);
    }),
    registerMcp(scope),
    command('openActive', () => git.active && preview(git.active)),
    command('newItem', async () => {
      const created = await createInScope(scope);
      if (!created) return;
      await model.refresh();
      await preview(created);
    }),
    ...Object.entries(edits(scope, editorFs)).map(([name, fn]) => command(name, async (w: WorkItem) => {
      if (!(await fn(w))) return;
      await afterChange(w);
    })),
    vscode.workspace.registerFileSystemProvider(SCHEME, editorFs, { isCaseSensitive: true }),
    editorFs.onDidSave(w => afterChange(w)),
  );
  present();
  void model.refresh(); // silent if not signed in yet: feeds the badge and notifications without opening the view
}
