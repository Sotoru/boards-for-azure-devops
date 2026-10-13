import * as vscode from 'vscode';
import type { Board } from './boardLogic';
import type { TeamField } from './filters';
import type { WorkItemUpdate } from './historyText';
import { adoError, normalizeTenant, unique } from './text';
import type { Comment, Fields, WorkItem } from './types';

// Azure DevOps resource ID: lets VS Code's built-in Microsoft login issue the token, no PAT to store.
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

export type { Comment, Fields, WorkItem } from './types';

// Background polling must not pop up a login dialog; interactive login is allowed once the user touches the extension.
let interactive = false;
export const allowLogin = () => { interactive = true; };
export class NotSignedIn extends Error {}

export async function session(tenant?: string) {
  const scopes = tenant ? [ADO_SCOPE, `VSCODE_TENANT:${tenant}`] : [ADO_SCOPE];
  const s = interactive
    ? await vscode.authentication.getSession('microsoft', scopes, { createIfNone: true })
    : await vscode.authentication.getSession('microsoft', scopes, { silent: true });
  if (!s) throw new NotSignedIn();
  return s;
}

// The org's tenant comes back in a header even on the unauthenticated redirect, so no login is needed to find it.
const tenants = new Map<string, Promise<string | undefined>>();
export function tenantOf(org: string) {
  if (!tenants.has(org)) {
    tenants.set(org, fetch(`https://dev.azure.com/${encodeURIComponent(org)}/_apis/connectionData`, { redirect: 'manual' })
      .then(r => normalizeTenant(r.headers.get('x-vss-resourcetenant')))
      .catch(() => undefined));
  }
  return tenants.get(org)!;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function request<T>(url: string, tenant: string | undefined, init: RequestInit = {}, retried = false): Promise<T> {
  const { accessToken } = await session(tenant);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
  });
  // Azure DevOps throttles with 429 (and 503 under load) and says how long to wait in Retry-After.
  // ponytail: one retry, capped at 30s; a backoff loop if users still hit throttling.
  if ((res.status === 429 || res.status === 503) && !retried) {
    await sleep(Math.min(Number(res.headers.get('retry-after')) || 5, 30) * 1000);
    return request<T>(url, tenant, init, true);
  }
  if (!res.ok) throw new Error(adoError(res.status, await res.text()));
  return res.json() as Promise<T>;
}

// Lists are capped server-side; say so instead of silently showing a partial list. Once per list per session, polling repeats them.
const warned = new Set<string>();
function capped<T>(list: T[], limit: number, key: string): T[] {
  if (list.length >= limit && !warned.has(key)) {
    warned.add(key);
    void vscode.window.showWarningMessage(vscode.l10n.t('Azure Boards: only the first {0} results are shown. Narrow the query or filters.', limit));
  }
  return list;
}

export async function ado<T = any>(org: string, path: string, init?: RequestInit): Promise<T> {
  return request<T>(`https://dev.azure.com/${encodeURIComponent(org)}/${path}`, await tenantOf(org), init);
}

export const proj = (w: WorkItem) => encodeURIComponent(w.fields['System.TeamProject']);
export const webUrl = (w: WorkItem) => `https://dev.azure.com/${encodeURIComponent(w.org)}/${proj(w)}/_workitems/edit/${w.id}`;

// Discovery only sees orgs in the signed-in account's home tenant; orgs elsewhere come from the setting.
async function discoverOrgs(): Promise<string[]> {
  try {
    const vssps = 'https://app.vssps.visualstudio.com/_apis';
    const me = await request<{ id: string }>(`${vssps}/profile/profiles/me?api-version=7.1`, undefined);
    const { value } = await request<{ value: { accountName: string }[] }>(`${vssps}/accounts?memberId=${me.id}&api-version=7.1`, undefined);
    return value.map(a => a.accountName);
  } catch {
    return [];
  }
}

let discovered: Promise<string[]> | undefined;
export async function listOrgs(): Promise<string[]> {
  discovered ??= discoverOrgs();
  const configured = vscode.workspace.getConfiguration('board_azr_devops').get<string[]>('organizations', []);
  return unique([...(await discovered), ...configured]);
}

export const listProjects = (org: string) =>
  ado<{ value: { name: string }[] }>(org, '_apis/projects?api-version=7.1&$top=500')
    .then(r => capped(r.value, 500, `projects:${org}`).map(p => p.name));

export const listTeams = (org: string, project: string) =>
  ado<{ value: { name: string }[] }>(org, `_apis/projects/${encodeURIComponent(project)}/teams?api-version=7.1&$top=500`)
    .then(r => capped(r.value, 500, `teams:${org}/${project}`).map(t => t.name));

const LIST_FIELDS = [
  'System.Title', 'System.State', 'System.WorkItemType', 'System.TeamProject', 'System.AssignedTo', 'System.IterationPath',
  'System.AreaPath', 'System.Tags', 'System.Parent', 'System.Description', 'Microsoft.VSTS.Common.Priority',
].join(',');

// The batch endpoint takes at most 200 ids per call.
async function fetchByIds(org: string, ids: number[], extraFields: string[] = []): Promise<WorkItem[]> {
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const fields = [LIST_FIELDS, ...extraFields].join(',');
  const pages = await Promise.all(chunks.map(c =>
    ado<{ value: { id: number; fields: Fields }[] }>(org, `_apis/wit/workitems?ids=${c.join(',')}&fields=${fields}&errorPolicy=omit&api-version=7.1`)));
  return pages.flatMap(p => p.value.filter(Boolean).map(w => ({ org, id: w.id, fields: w.fields })));
}

async function wiql(org: string, scopePath: string, query: string, extraFields?: string[]) {
  const { workItems } = await ado<{ workItems: { id: number }[] }>(org, `${scopePath}_apis/wit/wiql?api-version=7.1&$top=1000`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  return fetchByIds(org, capped(workItems, 1000, `wiql:${org}/${scopePath}${query}`).map(w => w.id), extraFields);
}

export const fetchMine = (org: string) =>
  wiql(org, '', vscode.workspace.getConfiguration('board_azr_devops').get<string>('query')!);

const teamPath = (project: string, team: string) => `${encodeURIComponent(project)}/${encodeURIComponent(team)}/`;

export async function getTeamField(org: string, project: string, team: string): Promise<TeamField & { defaultValue?: string }> {
  const r = await ado<{ field: { referenceName: string }; defaultValue?: string; values: { value: string; includeChildren: boolean }[] }>(
    org, `${teamPath(project, team)}_apis/work/teamsettings/teamfieldvalues?api-version=7.1`);
  return { field: r.field.referenceName, values: r.values, defaultValue: r.defaultValue };
}

export interface Iteration { name: string; path: string; attributes?: { timeFrame?: 'past' | 'current' | 'future' } }
export const listIterations = (org: string, project: string, team: string) =>
  ado<{ value: Iteration[] }>(org, `${teamPath(project, team)}_apis/work/teamsettings/iterations?api-version=7.1`).then(r => r.value);

export const getBacklogIteration = (org: string, project: string, team: string) =>
  ado<{ backlogIteration?: { name: string; path?: string } }>(org, `${teamPath(project, team)}_apis/work/teamsettings?api-version=7.1`)
    .then(r => r.backlogIteration?.path || r.backlogIteration?.name);

export const listMembers = (org: string, project: string, team: string) =>
  ado<{ value: { identity: { displayName: string; uniqueName: string } }[] }>(
    org, `_apis/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(team)}/members?api-version=7.1&$top=500`)
    .then(r => r.value.map(m => m.identity));

export const defaultTeam = (org: string, project: string) =>
  ado<{ defaultTeam?: { name: string } }>(org, `_apis/projects/${encodeURIComponent(project)}?api-version=7.1`).then(r => r.defaultTeam?.name);

// Types rarely change and the board asks for them on every refresh: cached for the session, dropped on failure so it can retry.
const typeCache = new Map<string, Promise<{ name: string; color?: string; isDisabled?: boolean }[]>>();
function workItemTypes(org: string, project: string) {
  const key = `${org}/${project}`;
  if (!typeCache.has(key)) {
    const p = ado<{ value: { name: string; color?: string; isDisabled?: boolean }[] }>(org, `${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.1`)
      .then(r => r.value);
    p.catch(() => typeCache.delete(key));
    typeCache.set(key, p);
  }
  return typeCache.get(key)!;
}

/** Work item types offered for creation: hidden ones (test cases, code reviews, ...) are left out. */
export async function listTypes(org: string, project: string) {
  const p = encodeURIComponent(project);
  const [types, cats] = await Promise.all([
    workItemTypes(org, project),
    ado<{ value: { referenceName: string; workItemTypes: { name: string }[] }[] }>(org, `${p}/_apis/wit/workitemtypecategories?api-version=7.1`),
  ]);
  const hidden = new Set(cats.value.find(c => c.referenceName === 'Microsoft.HiddenCategory')?.workItemTypes.map(t => t.name));
  return types.filter(t => !t.isDisabled && !hidden.has(t.name)).map(t => t.name).sort();
}

type Patch = { op: string; path: string; value?: unknown };
/** Known fields autocomplete; any other reference name (e.g. a board column field) is allowed too. */
export type FieldValues = Partial<Record<keyof Fields | (string & {}), unknown>>;
const fieldOps = (fields: FieldValues): Patch[] =>
  Object.entries(fields).map(([k, value]) => ({ op: 'add', path: `/fields/${k}`, value }));
const patchInit = (ops: Patch[]): RequestInit =>
  ({ method: 'PATCH', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(ops) });

export async function createWorkItem(org: string, project: string, type: string, fields: FieldValues, parentId?: number) {
  const ops = fieldOps(fields);
  if (parentId) {
    ops.push({ op: 'add', path: '/relations/-', value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workItems/${parentId}`,
    } });
  }
  const r = await ado<{ id: number; fields: Fields }>(org, `${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`,
    { ...patchInit(ops), method: 'POST' });
  return { org, id: r.id, fields: r.fields } satisfies WorkItem;
}

export const fetchByTeamQuery = (org: string, project: string, team: string, query: string, extraFields?: string[]) =>
  wiql(org, teamPath(project, team), query, extraFields);

export interface SavedQuery { id: string; name: string; isFolder?: boolean; hasChildren?: boolean; children?: SavedQuery[] }
/** Root folders (My Queries, Shared Queries) with their direct children, or the children of one folder. */
export const listQueries = (org: string, project: string, folderId?: string) => {
  const p = `${encodeURIComponent(project)}/_apis/wit/queries`;
  return folderId
    ? ado<SavedQuery>(org, `${p}/${folderId}?$depth=1&api-version=7.1`).then(r => r.children ?? [])
    : ado<{ value: SavedQuery[] }>(org, `${p}?$depth=1&api-version=7.1`).then(r => r.value);
};

// The team in the URL makes @CurrentIteration and @TeamAreas resolve. Tree and one-hop queries return links, shown flat.
export async function runQuery(org: string, project: string, team: string | undefined, id: string) {
  const scopePath = team ? teamPath(project, team) : `${encodeURIComponent(project)}/`;
  const r = await ado<{ workItems?: { id: number }[]; workItemRelations?: { target?: { id: number } }[] }>(
    org, `${scopePath}_apis/wit/wiql/${id}?api-version=7.1&$top=1000`);
  const ids = r.workItems?.map(w => w.id) ?? [...new Set(r.workItemRelations?.flatMap(l => l.target ? [l.target.id] : []))];
  return fetchByIds(org, capped(ids, 1000, `query:${org}/${id}`));
}

export const listBoards = (org: string, project: string, team: string) =>
  ado<{ value: { id: string; name: string }[] }>(org, `${teamPath(project, team)}_apis/work/boards?api-version=7.1`).then(r => r.value);

export const getBoard = (org: string, project: string, team: string, board: string) =>
  ado<Board>(org, `${teamPath(project, team)}_apis/work/boards/${encodeURIComponent(board)}?api-version=7.1`);

/** Type name → hex color as shown on Azure DevOps cards. */
export const typeColors = (org: string, project: string) =>
  workItemTypes(org, project).then(ts => Object.fromEntries(ts.map(t => [t.name, t.color ? `#${t.color.slice(-6)}` : ''])));

export interface FullWorkItem {
  rev: number; fields: Fields; multilineFieldsFormat?: Record<string, string>; relations?: { rel: string; url: string }[];
}
export const getWorkItemFull = (w: Pick<WorkItem, 'org' | 'id'>) =>
  ado<FullWorkItem>(w.org, `_apis/wit/workitems/${w.id}?$expand=relations&api-version=7.1`);
export const getWorkItem = (w: WorkItem) => getWorkItemFull(w).then(r => r.fields);
export const isMarkdown = (full: FullWorkItem, field: keyof Fields) => full.multilineFieldsFormat?.[field]?.toLowerCase() === 'markdown';

// renderedText is the HTML of Markdown comments; plain HTML comments only have text.
export const getComments = (w: WorkItem) =>
  ado<{ comments: Comment[] }>(w.org, `${proj(w)}/_apis/wit/workItems/${w.id}/comments?api-version=7.1-preview.4`).then(r => r.comments);

// ponytail: first 200 updates (the API default page); add $skip paging if items with longer histories show up.
export const getUpdates = (w: WorkItem) =>
  ado<{ value: WorkItemUpdate[] }>(w.org, `${proj(w)}/_apis/wit/workItems/${w.id}/updates?api-version=7.1`).then(r => r.value);

export const addComment = (w: WorkItem, html: string) =>
  ado(w.org, `${proj(w)}/_apis/wit/workItems/${w.id}/comments?api-version=7.1-preview.4`, {
    method: 'POST',
    body: JSON.stringify({ text: html }),
  });

/** category is one of Proposed, InProgress, Resolved, Completed, Removed. */
export const listStatesFull = (w: WorkItem) =>
  ado<{ value: { name: string; category: string }[] }>(w.org, `${proj(w)}/_apis/wit/workitemtypes/${encodeURIComponent(w.fields['System.WorkItemType'])}/states?api-version=7.1`)
    .then(r => r.value);
export const listStates = (w: WorkItem) => listStatesFull(w).then(ss => ss.map(s => s.name));

export interface PullRequest {
  pullRequestId: number; title: string; status: string; isDraft?: boolean; createdBy?: { displayName: string };
  repository: { name: string; project: { name: string } };
}
export const getPullRequest = (org: string, repoId: string, id: string) =>
  ado<PullRequest>(org, `_apis/git/repositories/${repoId}/pullrequests/${id}?api-version=7.1`);
export const prUrl = (org: string, pr: PullRequest) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(pr.repository.project.name)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;

export interface Commit { commitId: string; comment: string; author?: { name: string; date: string }; remoteUrl?: string }
export const getCommit = (org: string, projectId: string, repoId: string, sha: string) =>
  ado<Commit>(org, `${projectId}/_apis/git/repositories/${repoId}/commits/${sha}?api-version=7.1`);

/**
 * `rev` makes Azure DevOps reject the update if someone else changed the item since it was read,
 * so a long edit in the editor can't silently overwrite their changes.
 */
export function update(w: WorkItem, fields: FieldValues, opts: { rev?: number; markdown?: (keyof Fields)[] } = {}) {
  const ops: Patch[] = [
    ...(opts.rev !== undefined ? [{ op: 'test', path: '/rev', value: opts.rev }] : []),
    ...fieldOps(fields),
    ...(opts.markdown ?? []).map(f => ({ op: 'add', path: `/multilineFieldsFormat/${f}`, value: 'Markdown' })),
  ];
  return ado(w.org, `_apis/wit/workitems/${w.id}?api-version=7.1`, patchInit(ops));
}

export async function myIdentity(org: string) {
  return (await session(await tenantOf(org))).account.label;
}
