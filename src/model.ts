import * as vscode from 'vscode';
import { fetchByTeamQuery, fetchMine, getBoard, getTeamField, listBoards, NotSignedIn, WorkItem } from './api';
import { applyFilters, defaultFilters, Filters, GroupBy, newAssignments, teamQuery } from './filters';
import { ScopeStore } from './scope';

export type Mode = 'mine' | 'all';

// Holds fetched data and view settings; the tree only renders what this exposes.
export class Model {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly assigned = new vscode.EventEmitter<WorkItem[]>();
  readonly onNewAssignments = this.assigned.event;

  mine: WorkItem[] = [];
  items: WorkItem[] = [];
  /** Column names of the team's boards in board order; filled only when grouping by column. */
  columns: string[] = [];
  loaded = false;
  lastRefresh = 0;
  private running?: Promise<void>;

  constructor(private readonly state: vscode.Memento, readonly scope: ScopeStore) {}

  get mode(): Mode { return this.state.get<Mode>('mode', 'mine'); }
  async setMode(m: Mode) { await this.state.update('mode', m); await this.refresh(); }

  /** Filters and grouping are remembered per team in "All" (shared with the board), per org in "Mine". */
  private keyFor(mode: Mode) {
    const { org, project, team } = this.scope.current;
    return mode === 'mine' ? `mine:${org}` : `all:${org}/${project}/${team}`;
  }
  private get key() { return this.keyFor(this.mode); }

  filtersFor(mode: Mode): Filters { return { ...defaultFilters(), ...this.state.get<Partial<Filters>>(`filters:${this.keyFor(mode)}`) }; }
  get filters() { return this.filtersFor(this.mode); }
  async setFilters(f: Filters, mode: Mode = this.mode) {
    const refetch = mode === 'all' && this.mode === 'all' && f.currentSprint !== this.filtersFor(mode).currentSprint;
    await this.state.update(`filters:${this.keyFor(mode)}`, f);
    if (refetch) await this.refresh(); else this.changed.fire();
  }

  get groupBy(): GroupBy { return this.state.get<GroupBy>(`groupBy:${this.key}`, 'state'); }
  async setGroupBy(g: GroupBy) {
    // Board columns are fetched only for column grouping, so switching to it needs a reload.
    const refetch = g === 'column' && this.groupBy !== 'column';
    await this.state.update(`groupBy:${this.key}`, g);
    if (refetch) await this.refresh(); else this.changed.fire();
  }

  /** Each team board has its own column field: fetch them all with the list so items can be grouped by column. */
  private async boardColumns(org: string, project?: string, team?: string) {
    if (this.groupBy !== 'column' || !project || !team) return { fields: [], columns: [] };
    const boards = await Promise.all((await listBoards(org, project, team)).map(b => getBoard(org, project, team, b.id)));
    return { fields: boards.map(b => b.fields.columnField.referenceName), columns: [...new Set(boards.flatMap(b => b.columns.map(c => c.name)))] };
  }

  get visible() { return applyFilters(this.items, this.filters); }

  refresh(): Promise<void> {
    this.running ??= this.load().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async load() {
    const { org, project, team } = this.scope.current;
    let signedOut = false;
    try {
      if (!org) { this.mine = this.items = []; return; }
      const { fields, columns } = await this.boardColumns(org, project, team);
      this.columns = columns;
      this.mine = await fetchMine(org, fields);
      this.checkAssignments(org);
      if (this.mode === 'mine') this.items = this.mine;
      else if (project && team) {
        const field = await getTeamField(org, project, team);
        this.items = await fetchByTeamQuery(org, project, team, teamQuery(field, this.filters.currentSprint), fields);
      } else this.items = [];
    } catch (e) {
      // Not signed in yet: background polling stays quiet until the user opens the view or runs a command.
      signedOut = e instanceof NotSignedIn;
      if (!signedOut) vscode.window.showErrorMessage(`Azure Boards: ${(e as Error).message}`);
    } finally {
      this.loaded = !signedOut;
      this.lastRefresh = Date.now();
      this.changed.fire();
    }
  }

  private checkAssignments(org: string) {
    const key = `seen:${org}`;
    const ids = this.mine.map(w => w.id);
    const fresh = newAssignments(this.state.get<number[]>(key), ids);
    void this.state.update(key, ids);
    if (fresh.length) this.assigned.fire(this.mine.filter(w => fresh.includes(w.id)));
  }
}
