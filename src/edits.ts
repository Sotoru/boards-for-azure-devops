import * as vscode from 'vscode';
import {
  createWorkItem, defaultTeam, getBacklogIteration, getBoard, getTeamField, getWorkItemFull, isMarkdown, listBoards, listIterations, listMembers,
  listStates, listTypes, myIdentity, searchItems, setParent, update, webUrl, WorkItem,
} from './api';
import { columnOf } from './boardLogic';
import { editorUri, WorkItemEditorFs } from './editorFs';
import { isComplexHtml, normalizeTags } from './markdown';
import { ScopeStore } from './scope';

const t = vscode.l10n.t;
type Pick<T> = vscode.QuickPickItem & { value: T };

/** The current option goes first and is marked, so Enter keeps it. */
async function choose<T>(items: Promise<Pick<T>[]> | Pick<T>[], current: T | undefined, placeHolder: string) {
  const sorted = (await items).map(i => (i.value === current ? { ...i, description: [i.description, t('current')].filter(Boolean).join(' · ') } : i))
    .sort((a, b) => Number(b.value === current) - Number(a.value === current));
  return (await vscode.window.showQuickPick(sorted, { placeHolder, matchOnDescription: true }))?.value;
}

/** The scope's team when the item is in the scope's project, else the project's default team. */
async function teamFor(scope: ScopeStore, org: string, project: string) {
  const s = scope.current;
  if (s.org === org && s.project === project && s.team) return s.team;
  const team = await defaultTeam(org, project);
  if (!team) throw new Error(t('No team found in {0}', project));
  return team;
}

/** First board of the team that has a column for this work item type; none for types off the Kanban (e.g. tasks). */
async function boardFor(org: string, project: string, team: string, type: string) {
  for (const b of await listBoards(org, project, team)) {
    const board = await getBoard(org, project, team, b.id);
    if (board.columns.some(c => c.stateMappings[type])) return board;
  }
}

async function pickType(org: string, project: string) {
  return choose(listTypes(org, project).then(ts => ts.map(value => ({ label: value, value }))), undefined, t('Work item type'));
}

const project = (w: WorkItem) => w.fields['System.TeamProject'];
const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Parent picker: open items in the same area (other types), or a search by title or #id as you type. */
async function pickParent(w: WorkItem): Promise<number | null | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { id: number | null }>();
  qp.placeholder = t('Parent of #{0}: search by title or #id', w.id);
  qp.matchOnDescription = true;
  const current = w.fields['System.Parent'];
  const remove = current ? [{ label: `$(close) ${t('Remove parent')}`, description: `#${current}`, id: null, alwaysShow: true }] : [];
  let seq = 0;
  const load = async (text: string) => {
    const mine = ++seq;
    const id = Number(text.replace(/^#/, ''));
    const where = Number.isInteger(id) && id > 0 ? `[System.Id] = ${id}`
      : text ? `[System.Title] CONTAINS ${wiqlString(text)} AND [System.State] <> 'Removed'`
      : `[System.WorkItemType] <> ${wiqlString(w.fields['System.WorkItemType'])} AND [System.AreaPath] UNDER ${wiqlString(w.fields['System.AreaPath'] ?? project(w))}`
        + " AND [System.State] NOT IN ('Closed', 'Done', 'Removed')";
    qp.busy = true;
    try {
      const items = await searchItems(w.org, project(w), `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] <> ${w.id} AND ${where} ORDER BY [System.ChangedDate] DESC`);
      if (mine !== seq) return;
      qp.items = [...remove, ...items.map(i => ({
        label: `#${i.id} ${i.fields['System.Title']}`, description: [i.fields['System.WorkItemType'], i.fields['System.State'], i.id === current ? t('current') : ''].filter(Boolean).join(' · '),
        id: i.id, alwaysShow: !!text,
      }))];
    } catch (e) {
      if (mine === seq) qp.items = [...remove, { label: (e as Error).message, id: -1 }];
    } finally {
      if (mine === seq) qp.busy = false;
    }
  };
  // ponytail: 300 ms debounce, one query per pause; cancel in-flight requests if typing feels laggy.
  let timer: ReturnType<typeof setTimeout> | undefined;
  qp.onDidChangeValue(v => { clearTimeout(timer); timer = setTimeout(() => void load(v.trim()), 300); });
  void load('');
  const picked = await new Promise<number | null | undefined>(resolve => {
    qp.onDidAccept(() => { const id = qp.selectedItems[0]?.id; if (id !== -1) { resolve(id); qp.hide(); } });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  clearTimeout(timer);
  qp.dispose();
  return picked;
}

const askTitle = (prompt: string) =>
  vscode.window.showInputBox({ prompt, validateInput: v => (v.trim() ? undefined : t('The title cannot be empty')) });

// Each edit resolves to something truthy when it changed the item, so the caller knows to refresh.
export function edits(scope: ScopeStore, editorFs: WorkItemEditorFs): Record<string, (w: WorkItem) => Promise<unknown>> {
  return {
    async setState(w) {
      const states = listStates(w).then(ss => ss.map(value => ({ label: value, value })));
      const state = await choose(states, w.fields['System.State'], t('State'));
      return state && state !== w.fields['System.State'] && update(w, { 'System.State': state });
    },
    // Several columns can share a state: moving to a column sets both.
    async setColumn(w) {
      const type = w.fields['System.WorkItemType'];
      const board = await boardFor(w.org, project(w), await teamFor(scope, w.org, project(w)), type);
      if (!board) return void vscode.window.showInformationMessage(t('#{0} is not on any board of the team', w.id));
      const current = columnOf(board, (await getWorkItemFull(w)).fields as unknown as Record<string, unknown>);
      const columns = board.columns.filter(c => c.stateMappings[type])
        .map(c => ({ label: c.name, description: c.stateMappings[type], value: c }));
      const col = await choose(columns, columns.find(c => c.label === current)?.value, t('Board column ({0})', board.name));
      return col && col.name !== current
        && update(w, { [board.fields.columnField.referenceName]: col.name, 'System.State': col.stateMappings[type] });
    },
    async setTitle(w) {
      const title = await vscode.window.showInputBox({ value: w.fields['System.Title'], prompt: t('Title'), validateInput: v => (v.trim() ? undefined : t('The title cannot be empty')) });
      return title && title !== w.fields['System.Title'] && update(w, { 'System.Title': title.trim() });
    },
    async setPriority(w) {
      const labels = ['', t('Critical'), t('High'), t('Medium'), t('Low')];
      const p = await choose([1, 2, 3, 4].map(value => ({ label: String(value), description: labels[value], value })), w.fields['Microsoft.VSTS.Common.Priority'], t('Priority'));
      return p && p !== w.fields['Microsoft.VSTS.Common.Priority'] && update(w, { 'Microsoft.VSTS.Common.Priority': p });
    },
    async setTags(w) {
      const input = await vscode.window.showInputBox({ value: w.fields['System.Tags'] ?? '', prompt: t('Tags, separated by ; or ,  (empty removes all)') });
      if (input === undefined) return;
      const tags = normalizeTags(input);
      return tags !== (w.fields['System.Tags'] ?? '') && update(w, { 'System.Tags': tags });
    },
    async assign(w) {
      const team = await teamFor(scope, w.org, project(w));
      const [members, me] = await Promise.all([listMembers(w.org, project(w), team), myIdentity(w.org)]);
      const items: Pick<string>[] = [
        { label: `$(account) ${t('Me')}`, description: me, value: me },
        { label: `$(circle-slash) ${t('Unassigned')}`, value: '' },
        ...members.filter(m => m.uniqueName !== me).sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map(m => ({ label: m.displayName, description: m.uniqueName, value: m.uniqueName })),
      ];
      const current = w.fields['System.AssignedTo']?.uniqueName ?? '';
      const who = await choose(items, current, t('Assign to (members of {0})', team));
      return who !== undefined && who !== current && update(w, { 'System.AssignedTo': who });
    },
    async assignMe(w) {
      return update(w, { 'System.AssignedTo': await myIdentity(w.org) });
    },
    async setIteration(w) {
      const team = await teamFor(scope, w.org, project(w));
      const [iterations, backlog] = await Promise.all([listIterations(w.org, project(w), team), getBacklogIteration(w.org, project(w), team)]);
      const items: Pick<string>[] = [
        ...iterations.filter(i => i.attributes?.timeFrame !== 'past')
          .map(i => ({ label: i.name, description: i.attributes?.timeFrame === 'current' ? t('current sprint') : undefined, value: i.path })),
        ...(backlog ? [{ label: `$(archive) ${t('Backlog')}`, description: backlog, value: backlog }] : []),
      ];
      const path = await choose(items, w.fields['System.IterationPath'], t('Move to sprint'));
      return path && path !== w.fields['System.IterationPath'] && update(w, { 'System.IterationPath': path });
    },
    async editDescription(w) {
      const full = await getWorkItemFull(w);
      const html = full.fields['System.Description'] ?? '';
      if (!isMarkdown(full, 'System.Description') && isComplexHtml(html)) {
        const browser = t('Open in browser'), anyway = t('Edit anyway');
        const a = await vscode.window.showWarningMessage(
          t('The description of #{0} contains tables or images that editing here would remove.', w.id), { modal: true }, browser, anyway);
        if (a === browser) return void vscode.env.openExternal(vscode.Uri.parse(webUrl(w)));
        if (a !== anyway) return;
      }
      await vscode.window.showTextDocument(editorUri(w, 'description'), { preview: false });
      vscode.window.setStatusBarMessage(t('Save (Ctrl/Cmd+S) to send the description to Azure DevOps'), 6000);
    },
    async comment(w) {
      await vscode.window.showTextDocument(editorFs.openComment(w), { preview: false });
      vscode.window.setStatusBarMessage(t('Write your comment in Markdown and save (Ctrl/Cmd+S) to post it'), 6000);
    },
    async setParent(w) {
      const id = await pickParent(w);
      return id !== undefined && id !== (w.fields['System.Parent'] ?? null) && setParent(w, id ?? undefined);
    },
    async addChild(parent) {
      const type = await pickType(parent.org, project(parent));
      if (!type) return;
      const title = await askTitle(t('Title of the new {0} under #{1}', type, parent.id));
      if (!title) return;
      return createWorkItem(parent.org, project(parent), type, {
        'System.Title': title.trim(),
        'System.AreaPath': parent.fields['System.AreaPath'],
        'System.IterationPath': parent.fields['System.IterationPath'],
      }, parent.id);
    },
  };
}

/** New work item in the scope's project, in the team's default area and current sprint. */
export async function createInScope(scope: ScopeStore): Promise<WorkItem | undefined> {
  if (!scope.current.project) await scope.pick();
  const { org, project } = scope.current;
  if (!org || !project) return;
  const team = await teamFor(scope, org, project);
  const type = await pickType(org, project);
  if (!type) return;
  const title = await askTitle(t('Title of the new {0}', type));
  if (!title) return;
  const [field, iterations] = await Promise.all([getTeamField(org, project, team), listIterations(org, project, team)]);
  const current = iterations.find(i => i.attributes?.timeFrame === 'current');
  return createWorkItem(org, project, type, {
    'System.Title': title.trim(),
    ...(field.field === 'System.AreaPath' && field.defaultValue ? { 'System.AreaPath': field.defaultValue } : {}),
    ...(current ? { 'System.IterationPath': current.path } : {}),
  });
}
