import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMarkdown } from '../src/aiText.ts';

const fields = { 'System.Title': 'Fix login', 'System.State': 'Active', 'System.WorkItemType': 'Bug', 'System.TeamProject': 'Fabrikam' };

test('aiMarkdown: title, description, branch and commit only', () => {
  const md = aiMarkdown({ id: 42, fields, description: 'Users **cannot** log in.', reproSteps: 'Open the page', branch: 'bugfix/42' });
  assert.equal(md, [
    '# #42 Fix login (Bug)', '', 'Users **cannot** log in.', '',
    '- Branch: `bugfix/42`', '- Commit: include `#42` in the message, so Azure Repos links it to the work item.',
  ].join('\n'));
});

test('aiMarkdown: repro steps when there is no description, nothing when both are empty', () => {
  assert.match(aiMarkdown({ id: 42, fields, description: ' ', reproSteps: 'Open the page', branch: 'b' }), /\n\nOpen the page\n\n- Branch/);
  assert.match(aiMarkdown({ id: 42, fields, branch: 'b' }), /^# #42 Fix login \(Bug\)\n\n- Branch/);
});
