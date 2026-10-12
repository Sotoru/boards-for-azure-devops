// Pure sidebar logic (filters, grouping, team query), no `vscode` import, so it runs under `node --test`.
import type { WorkItem } from './types.ts';

export const FILTER_KEYS = ['state', 'type', 'assignee', 'iteration', 'tags', 'priority'] as const;
export type FilterKey = typeof FILTER_KEYS[number];
// Empty array = no filter on that key. `currentSprint` is applied server-side, only in "All" mode.
export type Filters = Record<FilterKey, string[]> & { currentSprint: boolean };

export const defaultFilters = (): Filters =>
  ({ state: [], type: [], assignee: [], iteration: [], tags: [], priority: [], currentSprint: true });

/** '' stands for "unassigned" / "no iteration" / "no priority". */
export function valuesOf(w: WorkItem, key: FilterKey): string[] {
  const f = w.fields;
  switch (key) {
    case 'state': return [f['System.State']];
    case 'type': return [f['System.WorkItemType']];
    case 'assignee': return [f['System.AssignedTo']?.displayName ?? ''];
    case 'iteration': return [f['System.IterationPath'] ?? ''];
    case 'priority': return [f['Microsoft.VSTS.Common.Priority']?.toString() ?? ''];
    case 'tags': return (f['System.Tags'] ?? '').split(';').map(t => t.trim()).filter(Boolean);
  }
}

export const applyFilters = (items: WorkItem[], f: Filters) =>
  items.filter(w => FILTER_KEYS.every(k => !f[k].length || valuesOf(w, k).some(v => f[k].includes(v))));

export const activeFilterCount = (f: Filters) => FILTER_KEYS.filter(k => f[k].length).length;

export function filterOptions(items: WorkItem[]): Record<FilterKey, string[]> {
  const out = {} as Record<FilterKey, string[]>;
  for (const k of FILTER_KEYS) {
    const vs = [...new Set(items.flatMap(w => valuesOf(w, k)))];
    out[k] = k === 'priority'
      ? vs.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : Number(a) - Number(b)))
      : vs.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }
  return out;
}

export type GroupBy = 'state' | 'hierarchy' | 'assignee' | 'none';
export interface Group { key: string; items: WorkItem[] }

// ponytail: fixed order of the default process states; unknown custom states sort alphabetically after them.
// Upgrade path: read state categories from the work item type API.
const STATE_ORDER = ['New', 'Proposed', 'To Do', 'Approved', 'Committed', 'Active', 'In Progress', 'Doing', 'Resolved', 'Done', 'Closed', 'Removed'];
const stateRank = (s: string) => { const i = STATE_ORDER.indexOf(s); return i < 0 ? STATE_ORDER.length : i; };

export function groupItems(items: WorkItem[], by: 'state' | 'assignee'): Group[] {
  const groups = new Map<string, WorkItem[]>();
  for (const w of items) {
    const key = valuesOf(w, by === 'state' ? 'state' : 'assignee')[0];
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  const cmp = by === 'state'
    ? (a: string, b: string) => stateRank(a) - stateRank(b) || a.localeCompare(b)
    : (a: string, b: string) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b));
  return [...groups.keys()].sort(cmp).map(key => ({ key, items: groups.get(key)! }));
}

/** Items whose parent is not in the list become roots. */
export function hierarchy(items: WorkItem[]) {
  const ids = new Set(items.map(w => w.id));
  const children = new Map<number, WorkItem[]>();
  const roots: WorkItem[] = [];
  for (const w of items) {
    const p = w.fields['System.Parent'];
    if (p !== undefined && ids.has(p)) children.set(p, [...(children.get(p) ?? []), w]);
    else roots.push(w);
  }
  return { roots, children };
}

export interface TeamField { field: string; values: { value: string; includeChildren: boolean }[] }
const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Query for the "All" view; must be posted to the team-scoped WIQL endpoint so @project/@CurrentIteration resolve. */
export function teamQuery(team: TeamField, currentSprint: boolean) {
  const areas = team.values
    .map(v => `[${team.field}] ${v.includeChildren ? 'UNDER' : '='} ${wiqlString(v.value)}`)
    .join(' OR ');
  return [
    'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project',
    areas && `AND (${areas})`,
    "AND [System.State] NOT IN ('Closed', 'Done', 'Removed')",
    currentSprint && 'AND [System.IterationPath] = @CurrentIteration',
    'ORDER BY [System.ChangedDate] DESC',
  ].filter(Boolean).join(' ');
}

/** Ids assigned since the last check; nothing on the first check, so existing items don't all notify at once. */
export const newAssignments = (seen: number[] | undefined, now: number[]) =>
  seen ? now.filter(id => !seen.includes(id)) : [];
