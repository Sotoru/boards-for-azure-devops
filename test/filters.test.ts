import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFilterCount, applyFilters, defaultFilters, filterOptions, groupItems, hierarchy, newAssignments, teamQuery,
} from '../src/filters.ts';
import type { Fields, WorkItem } from '../src/types.ts';

const wi = (id: number, f: Partial<Fields> = {}): WorkItem => ({
  org: 'contoso',
  id,
  fields: { 'System.Title': `Item ${id}`, 'System.State': 'Active', 'System.WorkItemType': 'Task', 'System.TeamProject': 'Fabrikam Fiber', ...f },
});
const alice = { displayName: 'Alice', uniqueName: 'alice@contoso.com' };

const items = [
  wi(1, { 'System.State': 'New', 'System.Tags': 'ui; backend', 'Microsoft.VSTS.Common.Priority': 2 }),
  wi(2, { 'System.AssignedTo': alice, 'System.WorkItemType': 'Bug', 'Microsoft.VSTS.Common.Priority': 1 }),
  wi(3, { 'System.State': 'Resolved', 'System.Parent': 2, 'System.AssignedTo': alice, 'System.Tags': 'ui' }),
  wi(4, { 'System.State': 'Custom', 'System.Parent': 99 }),
];

test('applyFilters: OR within a key, AND across keys, empty = no filter', () => {
  const f = defaultFilters();
  assert.equal(applyFilters(items, f).length, 4);
  assert.deepEqual(applyFilters(items, { ...f, state: ['New', 'Resolved'] }).map(w => w.id), [1, 3]);
  assert.deepEqual(applyFilters(items, { ...f, tags: ['ui'], assignee: ['Alice'] }).map(w => w.id), [3]);
  assert.deepEqual(applyFilters(items, { ...f, assignee: [''] }).map(w => w.id), [1, 4]);
});

test('activeFilterCount ignores the server-side sprint flag', () => {
  assert.equal(activeFilterCount({ ...defaultFilters(), state: ['New'], tags: ['ui'], currentSprint: false }), 2);
});

test('filterOptions lists values from the data, empty last, priority numeric', () => {
  const o = filterOptions(items);
  assert.deepEqual(o.state, ['Active', 'Custom', 'New', 'Resolved']);
  assert.deepEqual(o.tags, ['backend', 'ui']);
  assert.deepEqual(o.assignee, ['Alice', '']);
  assert.deepEqual(o.priority, ['1', '2', '']);
});

test('groupItems: states in process order, unknown last; unassigned last', () => {
  assert.deepEqual(groupItems(items, 'state').map(g => g.key), ['New', 'Active', 'Resolved', 'Custom']);
  assert.deepEqual(groupItems(items, 'assignee').map(g => [g.key, g.items.length]), [['Alice', 2], ['', 2]]);
});

test('hierarchy nests children under parents in the list only', () => {
  const h = hierarchy(items);
  assert.deepEqual(h.roots.map(w => w.id), [1, 2, 4]);
  assert.deepEqual(h.children.get(2)?.map(w => w.id), [3]);
});

test('teamQuery builds area clauses, escapes quotes, toggles sprint', () => {
  const q = teamQuery({ field: 'System.AreaPath', values: [{ value: "Fabrikam\\O'Neil", includeChildren: true }, { value: 'Fabrikam', includeChildren: false }] }, true);
  assert.match(q, /\(\[System\.AreaPath\] UNDER 'Fabrikam\\O''Neil' OR \[System\.AreaPath\] = 'Fabrikam'\)/);
  assert.match(q, /@CurrentIteration/);
  assert.doesNotMatch(teamQuery({ field: 'System.AreaPath', values: [] }, false), /@CurrentIteration|AND \(/);
});

test('newAssignments is silent on first run', () => {
  assert.deepEqual(newAssignments(undefined, [1, 2]), []);
  assert.deepEqual(newAssignments([1], [1, 2, 3]), [2, 3]);
});
