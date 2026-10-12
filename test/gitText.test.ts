import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchName, hasCommitRef, idFromBranch, parseArtifactLinks } from '../src/gitText.ts';
import type { WorkItem } from '../src/types.ts';

const wi = (id: number, type: string, title = 'Fix the Login page!'): WorkItem =>
  ({ org: 'contoso', id, fields: { 'System.Title': title, 'System.State': 'New', 'System.WorkItemType': type, 'System.TeamProject': 'Fabrikam' } });

test('branchName fills the template', () => {
  assert.equal(branchName('{type}/{id}', wi(123, 'Task')), 'feature/123');
  assert.equal(branchName('{type}/{id}', wi(7, 'Bug')), 'bugfix/7');
  assert.equal(branchName('users/me/{id}-{title}', wi(5, 'User Story', 'Perché è così lento?')), 'users/me/5-perche-e-cosi-lento');
  assert.equal(branchName('{id}', wi(9, 'Task')), '9');
});

test('idFromBranch finds the first all-digit segment', () => {
  assert.equal(idFromBranch('feature/123'), 123);
  assert.equal(idFromBranch('users/me/456-fix-login'), 456);
  assert.equal(idFromBranch('bugfix/78_hotfix'), 78);
  assert.equal(idFromBranch('main'), undefined);
  assert.equal(idFromBranch('release/2.0'), undefined);
  assert.equal(idFromBranch(undefined), undefined);
});

test('hasCommitRef matches the exact id only', () => {
  assert.ok(hasCommitRef('#12 fix', 12));
  assert.ok(hasCommitRef('fix (#12)', 12));
  assert.ok(!hasCommitRef('#123 fix', 12));
  assert.ok(!hasCommitRef('a#12', 12));
});

test('parseArtifactLinks reads PR and commit links, ignores others', () => {
  const links = parseArtifactLinks([
    { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/p1%2Fr1%2F42' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/p1%2Fr1%2Fabc123' },
    { rel: 'ArtifactLink', url: 'vstfs:///Build/Build/9' },
    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/contoso/_apis/wit/workItems/1' },
  ]);
  assert.deepEqual(links, [
    { kind: 'pr', projectId: 'p1', repoId: 'r1', key: '42' },
    { kind: 'commit', projectId: 'p1', repoId: 'r1', key: 'abc123' },
  ]);
  assert.deepEqual(parseArtifactLinks(undefined), []);
});
