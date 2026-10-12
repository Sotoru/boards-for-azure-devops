import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMarkdown } from '../src/aiText.ts';

test('aiMarkdown includes fields, sections and comments, skips empty ones', () => {
  const md = aiMarkdown({
    id: 42,
    url: 'https://dev.azure.com/contoso/Fabrikam/_workitems/edit/42',
    fields: {
      'System.Title': 'Fix login', 'System.State': 'Active', 'System.WorkItemType': 'Bug', 'System.TeamProject': 'Fabrikam',
      'System.AssignedTo': { displayName: 'Alice', uniqueName: 'alice@contoso.com' }, 'System.Parent': 7,
    },
    description: 'Users **cannot** log in.',
    reproSteps: '  ',
    comments: [{ author: 'Bob', date: '2026-01-02T10:00:00Z', text: 'Seen on prod.' }],
  });
  assert.match(md, /^# #42 Fix login\n/);
  assert.match(md, /- \*\*Assigned to:\*\* Alice/);
  assert.match(md, /- \*\*Parent:\*\* #7/);
  assert.match(md, /## Description\n\nUsers \*\*cannot\*\* log in\./);
  assert.doesNotMatch(md, /Repro steps|Acceptance criteria|Priority/);
  assert.match(md, /\*\*Bob\*\* \(2026-01-02\):\n\nSeen on prod\./);
  assert.match(md, /reference this work item with #42/);
});
