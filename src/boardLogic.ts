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
  fields: { columnField: { referenceName: string } };
}

const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
const wiqlList = (xs: string[]) => xs.map(wiqlString).join(', ');

/** Work item types that appear on the board: the ones every column maps to a state. */
export const boardTypes = (b: Board) => [...new Set(b.columns.flatMap(c => Object.keys(c.stateMappings)))];

// ponytail: finished items are kept for 30 days so the Done column isn't the whole history; make it a setting if needed.
export const DONE_DAYS = 30;

/** Must be posted to the team-scoped WIQL endpoint so @project/@CurrentIteration resolve. */
export function boardQuery(team: TeamField, b: Board, currentSprint: boolean) {
  const done = [...new Set(b.columns.filter(c => c.columnType === 'outgoing').flatMap(c => Object.values(c.stateMappings)))];
  const areas = team.values.map(v => `[${team.field}] ${v.includeChildren ? 'UNDER' : '='} ${wiqlString(v.value)}`).join(' OR ');
  return [
    'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project',
    areas && `AND (${areas})`,
    `AND [System.WorkItemType] IN (${wiqlList(boardTypes(b))})`,
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

/** State a card must take when dropped in a column; undefined if the column doesn't accept its type. */
export const targetState = (b: Board, column: string, type: string) =>
  b.columns.find(c => c.name === column)?.stateMappings[type];

export const initials = (name: string | undefined) =>
  (name ?? '').split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
