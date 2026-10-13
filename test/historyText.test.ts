import { test } from 'node:test';
import assert from 'node:assert/strict';
import { display, historyEntries, statePath, type WorkItemUpdate } from '../src/historyText.ts';

const updates: WorkItemUpdate[] = [
  { rev: 1, revisedBy: { displayName: 'Jamal Hartnett' }, revisedDate: 'x', fields: {
    'System.State': { newValue: 'New' }, 'System.Title': { newValue: 'Fix login' }, 'System.ChangedDate': { newValue: '2026-01-01T10:00:00Z' } } },
  { rev: 2, revisedBy: { displayName: 'Jamal Hartnett' }, revisedDate: 'x', fields: { 'System.Rev': { oldValue: 1, newValue: 2 } } },
  { rev: 3, revisedBy: { displayName: 'Norman Paulk' }, revisedDate: '9999-01-01T00:00:00Z', fields: {
    'System.State': { oldValue: 'New', newValue: 'Active' },
    'System.AssignedTo': { newValue: { displayName: 'Norman Paulk' } },
    'WEF_ABC_Kanban.Column': { oldValue: 'New', newValue: 'Blocked' },
    'WEF_ABC_Kanban.Column.Done': { oldValue: false, newValue: true },
    'System.ChangedDate': { newValue: '2026-01-02T10:00:00Z' },
  }, relations: { added: [{}] } },
];

test('historyEntries drops noise, keeps visible changes, newest first', () => {
  const h = historyEntries(updates);
  assert.deepEqual(h.map(e => e.rev), [3, 1]);
  assert.equal(h[0].date, '2026-01-02T10:00:00Z');
  assert.deepEqual(h[0].changes, [
    { field: 'System.State', from: 'New', to: 'Active' },
    { field: 'System.AssignedTo', from: undefined, to: 'Norman Paulk' },
    { field: 'WEF_ABC_Kanban.Column', from: 'New', to: 'Blocked' },
  ]);
  assert.equal(h[0].linksAdded, 1);
  assert.equal(h[1].created, true);
});

test('statePath lists states oldest first', () => {
  assert.deepEqual(statePath(updates).map(s => s.state), ['New', 'Active']);
});

test('display flattens html and cuts long text', () => {
  assert.equal(display('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(display('x'.repeat(100))!.length, 81);
  assert.equal(display(''), undefined);
});
