import * as vscode from 'vscode';
import { listOrgs, listProjects, listTeams } from './api';

export interface Scope { org?: string; project?: string; team?: string }

// Active org lives in globalState; project/team are remembered per org.
export class ScopeStore {
  private readonly changed = new vscode.EventEmitter<Scope>();
  readonly onDidChange = this.changed.event;
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

  constructor(private readonly state: vscode.Memento) {
    this.status.command = 'board_azr_devops.switchScope';
    this.status.tooltip = vscode.l10n.t('Azure Boards: switch organization, project and team');
    this.render();
    this.status.show();
  }

  get current(): Scope {
    const org = this.state.get<string>('org');
    return org ? { org, ...this.state.get<Scope>(`scope:${org}`) } : {};
  }

  private async set(scope: Scope) {
    await this.state.update('org', scope.org);
    if (scope.org) await this.state.update(`scope:${scope.org}`, { project: scope.project, team: scope.team });
    this.render();
    this.changed.fire(this.current);
  }

  private render() {
    const { org, project, team } = this.current;
    this.status.text = org
      ? `$(organization) ${org}${project ? ` · ${project}${team ? ` / ${team}` : ''}` : ''}`
      : `$(organization) ${vscode.l10n.t('Choose organization')}`;
  }

  async pick() {
    // The current choice goes first so Enter keeps it.
    const pickOne = async (names: Promise<string[]>, placeHolder: string, active?: string) => {
      const items = names.then((xs): vscode.QuickPickItem[] => [
        ...xs.filter(x => x === active).map(label => ({ label, description: vscode.l10n.t('current') })),
        ...xs.filter(x => x !== active).map(label => ({ label })),
      ]);
      return (await vscode.window.showQuickPick(items, { placeHolder, ignoreFocusOut: true }))?.label;
    };

    const prev = this.current;
    const org = await pickOne(listOrgs(), vscode.l10n.t('Organization (add others in the "organizations" setting)'), prev.org);
    if (!org) return;
    const remembered = this.state.get<Scope>(`scope:${org}`) ?? {};
    // Esc on the next steps keeps the org change and whatever was remembered for it.
    const project = await pickOne(listProjects(org), vscode.l10n.t('Project in {0}', org), remembered.project);
    if (!project) return this.set({ org, ...remembered });
    const team = await pickOne(listTeams(org, project), vscode.l10n.t('Team in {0}', project), remembered.team);
    await this.set({ org, project, team: team ?? (project === remembered.project ? remembered.team : undefined) });
  }

  dispose() { this.status.dispose(); this.changed.dispose(); }
}
