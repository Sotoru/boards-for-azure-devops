// Pure Kanban logic, no `vscode` import, so it runs under `node --test`.
import type { TeamField } from './filters.ts';

export interface BoardColumn {
  id: string;
  name: string;
  itemLimit: number;
  stateMappings: Record<string, string>;
  columnType: 'incoming' | 'inProgress' | 'outgoing';
  isSplit?: boolean;
}
export interface Board {
  id: string;
  name: string;
  columns: BoardColumn[];
  /** Swimlanes, top to bottom; the default lane has no name. */
  rows?: { id: string; name: string | null }[];
  fields: { columnField: { referenceName: string }; rowField?: { referenceName: string } };
}

const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
const wiqlList = (xs: string[]) => xs.map(wiqlString).join(', ');

/** Work item types that appear on the board: the ones every column maps to a state. */
export const boardTypes = (b: Board) => [...new Set(b.columns.flatMap(c => Object.keys(c.stateMappings)))];

// ponytail: finished items are kept for 30 days so the Done column isn't the whole history; make it a setting if needed.
export const DONE_DAYS = 30;

/** Team settings give iteration paths without the project ('' for the root, or '\Release 1'); WIQL needs them in full. */
export function fullIterationPath(project: string, path: string | undefined) {
  if (!path) return project;
  if (path === project || path.startsWith(`${project}\\`)) return path;
  return `${project}${path.startsWith('\\') ? '' : '\\'}${path}`;
}

/**
 * Must be posted to the team-scoped WIQL endpoint so @project/@CurrentIteration resolve.
 * Like Azure DevOps, the board only holds items under the team's backlog iteration, without `hiddenTypes` (bugs the team doesn't track as requirements).
 */
export function boardQuery(team: TeamField, b: Board, currentSprint: boolean, opts: { backlogIteration?: string; hiddenTypes?: string[] } = {}) {
  const types = boardTypes(b).filter(t => !opts.hiddenTypes?.includes(t));
  const done = [...new Set(b.columns.filter(c => c.columnType === 'outgoing').flatMap(c => Object.values(c.stateMappings)))];
  const areas = team.values.map(v => `[${team.field}] ${v.includeChildren ? 'UNDER' : '='} ${wiqlString(v.value)}`).join(' OR ');
  return [
    'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project',
    areas && `AND (${areas})`,
    `AND [System.WorkItemType] IN (${wiqlList(types)})`,
    opts.backlogIteration && `AND [System.IterationPath] UNDER ${wiqlString(opts.backlogIteration)}`,
    "AND [System.State] <> 'Removed'",
    done.length && `AND ([System.State] NOT IN (${wiqlList(done)}) OR [System.ChangedDate] >= @Today - ${DONE_DAYS})`,
    currentSprint && 'AND [System.IterationPath] = @CurrentIteration',
    'ORDER BY [System.ChangedDate] DESC',
  ].filter(Boolean).join(' ');
}

/** The board column field when it names a column; otherwise the first column mapping the item's state. */
export function columnOf(b: Board, fields: Record<string, unknown>): string {
  const col = fields[b.fields.columnField.referenceName];
  if (typeof col === 'string' && b.columns.some(c => c.name === col)) return col;
  const type = String(fields['System.WorkItemType']);
  const state = String(fields['System.State']);
  return (b.columns.find(c => c.stateMappings[type] === state) ?? b.columns[0])?.name ?? '';
}

/** Lane names in board order, '' for the default lane. */
export const laneNames = (b: Board) => (b.rows?.length ? b.rows.map(r => r.name ?? '') : ['']);

/** The item's lane; '' (default lane) when the field is empty or names a lane that no longer exists. */
export function laneOf(b: Board, fields: Record<string, unknown>): string {
  const lane = b.fields.rowField && fields[b.fields.rowField.referenceName];
  return typeof lane === 'string' && laneNames(b).includes(lane) ? lane : '';
}

/** Lanes the card can move between: none without swimlanes, or in incoming and outgoing columns, which span all lanes. */
export function movableLanes(b: Board, fields: Record<string, unknown>): string[] {
  const lanes = laneNames(b);
  const column = b.columns.find(c => c.name === columnOf(b, fields));
  return b.fields.rowField && lanes.length > 1 && column?.columnType === 'inProgress' ? lanes : [];
}

/** State a card must take when dropped in a column; undefined if the column doesn't accept its type. */
export const targetState = (b: Board, column: string, type: string) =>
  b.columns.find(c => c.name === column)?.stateMappings[type];

export const initials = (name: string | undefined) =>
  (name ?? '').split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
