import * as vscode from 'vscode';
import type { TeamField } from './filters';
import { normalizeTenant, unique } from './text';
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

async function request<T>(url: string, tenant: string | undefined, init: RequestInit = {}): Promise<T> {
  const { accessToken } = await session(tenant);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
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
  ado<{ value: { name: string }[] }>(org, '_apis/projects?api-version=7.1&$top=500').then(r => r.value.map(p => p.name));

export const listTeams = (org: string, project: string) =>
  ado<{ value: { name: string }[] }>(org, `_apis/projects/${encodeURIComponent(project)}/teams?api-version=7.1&$top=500`)
    .then(r => r.value.map(t => t.name));

const LIST_FIELDS = [
  'System.Title', 'System.State', 'System.WorkItemType', 'System.TeamProject', 'System.AssignedTo', 'System.IterationPath',
  'System.Tags', 'System.Parent', 'System.Description', 'Microsoft.VSTS.Common.Priority',
].join(',');

// The batch endpoint takes at most 200 ids per call.
async function fetchByIds(org: string, ids: number[]): Promise<WorkItem[]> {
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const pages = await Promise.all(chunks.map(c =>
    ado<{ value: { id: number; fields: Fields }[] }>(org, `_apis/wit/workitems?ids=${c.join(',')}&fields=${LIST_FIELDS}&errorPolicy=omit&api-version=7.1`)));
  return pages.flatMap(p => p.value.filter(Boolean).map(w => ({ org, id: w.id, fields: w.fields })));
}

async function wiql(org: string, scopePath: string, query: string) {
  const { workItems } = await ado<{ workItems: { id: number }[] }>(org, `${scopePath}_apis/wit/wiql?api-version=7.1&$top=1000`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  return fetchByIds(org, workItems.map(w => w.id));
}

export const fetchMine = (org: string) =>
  wiql(org, '', vscode.workspace.getConfiguration('board_azr_devops').get<string>('query')!);

const teamPath = (project: string, team: string) => `${encodeURIComponent(project)}/${encodeURIComponent(team)}/`;

export async function getTeamField(org: string, project: string, team: string): Promise<TeamField> {
  const r = await ado<{ field: { referenceName: string }; values: { value: string; includeChildren: boolean }[] }>(
    org, `${teamPath(project, team)}_apis/work/teamsettings/teamfieldvalues?api-version=7.1`);
  return { field: r.field.referenceName, values: r.values };
}

export const fetchByTeamQuery = (org: string, project: string, team: string, query: string) =>
  wiql(org, teamPath(project, team), query);

export const getWorkItem = (w: WorkItem) =>
  ado<{ fields: Fields }>(w.org, `_apis/wit/workitems/${w.id}?api-version=7.1`).then(r => r.fields);

export const getComments = (w: WorkItem) =>
  ado<{ comments: Comment[] }>(w.org, `${proj(w)}/_apis/wit/workItems/${w.id}/comments?api-version=7.1-preview.4`).then(r => r.comments);

export const addComment = (w: WorkItem, html: string) =>
  ado(w.org, `${proj(w)}/_apis/wit/workItems/${w.id}/comments?api-version=7.1-preview.4`, {
    method: 'POST',
    body: JSON.stringify({ text: html }),
  });

export const listStates = (w: WorkItem) =>
  ado<{ value: { name: string }[] }>(w.org, `${proj(w)}/_apis/wit/workitemtypes/${encodeURIComponent(w.fields['System.WorkItemType'])}/states?api-version=7.1`)
    .then(r => r.value.map(s => s.name));

export const update = (w: WorkItem, fields: Partial<Record<keyof Fields, unknown>>) =>
  ado(w.org, `_apis/wit/workitems/${w.id}?api-version=7.1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify(Object.entries(fields).map(([k, value]) => ({ op: 'add', path: `/fields/${k}`, value }))),
  });

export async function myIdentity(org: string) {
  return (await session(await tenantOf(org))).account.label;
}
