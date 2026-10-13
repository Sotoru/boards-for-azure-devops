import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Board, boardQuery, boardTypes, columnOf, fullIterationPath, initials, laneNames, laneOf, targetState } from '../src/boardLogic.ts';

const board: Board = {
  id: 'b1',
  name: 'Stories',
  fields: { columnField: { referenceName: 'WEF_X_Kanban.Column' } },
  columns: [
    { id: '1', name: 'New', itemLimit: 0, columnType: 'incoming', stateMappings: { 'User Story': 'New', Bug: 'New' } },
    { id: '2', name: 'Active', itemLimit: 5, columnType: 'inProgress', stateMappings: { 'User Story': 'Active', Bug: 'Active' } },
    { id: '3', name: 'Review', itemLimit: 3, columnType: 'inProgress', stateMappings: { 'User Story': 'Active', Bug: 'Resolved' } },
    { id: '4', name: 'Closed', itemLimit: 0, columnType: 'outgoing', stateMappings: { 'User Story': 'Closed', Bug: 'Closed' } },
  ],
};

test('boardTypes lists mapped types once', () => {
  assert.deepEqual(boardTypes(board), ['User Story', 'Bug']);
});

test('boardQuery: area, types, recent done only, optional sprint', () => {
  const q = boardQuery({ field: 'System.AreaPath', values: [{ value: 'Fabrikam', includeChildren: true }] }, board, false);
  assert.match(q, /\[System\.WorkItemType\] IN \('User Story', 'Bug'\)/);
  assert.match(q, /NOT IN \('Closed'\) OR \[System\.ChangedDate\] >= @Today - 30/);
  assert.match(q, /\[System\.AreaPath\] UNDER 'Fabrikam'/);
  assert.doesNotMatch(q, /@CurrentIteration/);
  assert.match(boardQuery({ field: 'System.AreaPath', values: [] }, board, true), /@CurrentIteration/);
});

test('columnOf prefers the board column field, falls back to state mapping', () => {
  assert.equal(columnOf(board, { 'WEF_X_Kanban.Column': 'Review', 'System.WorkItemType': 'Bug', 'System.State': 'Resolved' }), 'Review');
  assert.equal(columnOf(board, { 'System.WorkItemType': 'Bug', 'System.State': 'Active' }), 'Active');
  assert.equal(columnOf(board, { 'WEF_X_Kanban.Column': 'Gone', 'System.WorkItemType': 'Bug', 'System.State': 'Closed' }), 'Closed');
  assert.equal(columnOf(board, { 'System.WorkItemType': 'Task', 'System.State': 'Weird' }), 'New');
});

test('targetState maps per type, undefined for unknown types', () => {
  assert.equal(targetState(board, 'Review', 'Bug'), 'Resolved');
  assert.equal(targetState(board, 'Review', 'User Story'), 'Active');
  assert.equal(targetState(board, 'Review', 'Task'), undefined);
});

test('initials', () => {
  assert.equal(initials('Alice Smith'), 'AS');
  assert.equal(initials('alice.smith@contoso.com'), 'AS');
  assert.equal(initials(undefined), '');
});

test('laneOf: named lane, empty or unknown falls back to the default lane', () => {
  const laned: Board = { ...board, rows: [{ id: '0', name: null }, { id: '1', name: 'Expedite' }], fields: { ...board.fields, rowField: { referenceName: 'WEF_X_Kanban.Lane' } } };
  assert.deepEqual(laneNames(laned), ['', 'Expedite']);
  assert.deepEqual(laneNames(board), ['']);
  assert.equal(laneOf(laned, { 'WEF_X_Kanban.Lane': 'Expedite' }), 'Expedite');
  assert.equal(laneOf(laned, { 'WEF_X_Kanban.Lane': 'Gone' }), '');
  assert.equal(laneOf(laned, {}), '');
  assert.equal(laneOf(board, { 'WEF_X_Kanban.Lane': 'Expedite' }), '');
});

test('fullIterationPath adds the project to team settings paths', () => {
  assert.equal(fullIterationPath('Fabrikam', ''), 'Fabrikam');
  assert.equal(fullIterationPath('Fabrikam', undefined), 'Fabrikam');
  assert.equal(fullIterationPath('Fabrikam', '\\Release 1'), 'Fabrikam\\Release 1');
  assert.equal(fullIterationPath('Fabrikam', 'Release 1'), 'Fabrikam\\Release 1');
  assert.equal(fullIterationPath('Fabrikam', 'Fabrikam\\Release 1'), 'Fabrikam\\Release 1');
});

test('boardQuery: backlog iteration and hidden bug types', () => {
  const q = boardQuery({ field: 'System.AreaPath', values: [] }, board, false, { backlogIteration: "Fabrikam\\O'Neil", hiddenTypes: ['Bug'] });
  assert.match(q, /\[System\.WorkItemType\] IN \('User Story'\)/);
  assert.match(q, /\[System\.IterationPath\] UNDER 'Fabrikam\\O''Neil'/);
});
