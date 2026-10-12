import * as vscode from 'vscode';
import { allowLogin, getComments, WorkItem } from './api';
import { groupItems, hierarchy } from './filters';
import { Model } from './model';
import { htmlToMarkdown } from './markdown';
import { descLines, plain } from './text';

type Row = { row: vscode.TreeItem };
type GroupNode = { group: string; label: string; items: WorkItem[] };
type DetailsNode = { details: WorkItem };
type CommentsNode = { comments: WorkItem };
// WorkItem nodes are the work items themselves, so context-menu commands receive a WorkItem directly.
type Node = WorkItem | GroupNode | DetailsNode | CommentsNode | Row;
const SIDEBAR_COMMENTS = 20;
const t = vscode.l10n.t;

function row(icon: string, label: string, description?: string, extra: Partial<vscode.TreeItem> = {}): Row {
  return { row: Object.assign(new vscode.TreeItem(label), { iconPath: new vscode.ThemeIcon(icon), description }, extra) };
}

/** Fetched only when the "Comments" node is expanded, newest first. */
async function commentRows(w: WorkItem): Promise<Row[]> {
  const comments = await getComments(w, 'desc');
  const rows = comments.slice(0, SIDEBAR_COMMENTS).map(c => {
    // A comment with renderedText was written in Markdown (text is the source); otherwise text is HTML.
    const md = c.renderedText ? c.text : htmlToMarkdown(c.text);
    const date = new Date(c.createdDate).toLocaleDateString();
    return row('comment', `${c.createdBy?.displayName ?? '?'} · ${date}`, plain(c.renderedText ?? c.text).slice(0, 120), {
      tooltip: new vscode.MarkdownString(`**${c.createdBy?.displayName ?? '?'}** · ${new Date(c.createdDate).toLocaleString()}\n\n${md}`),
    });
  });
  const more = comments.length > SIDEBAR_COMMENTS
    ? [row('ellipsis', t('{0} more in "Show all"', comments.length - SIDEBAR_COMMENTS), undefined, { command: { command: 'board_azr_devops.preview', title: t('Show all'), arguments: [w] } })]
    : [];
  const add = row('add', t('New comment…'), undefined, { command: { command: 'board_azr_devops.comment', title: t('Comment'), arguments: [w] } });
  return [...(rows.length ? rows : [row('blank', t('No comments'))]), ...more, add];
}

function detailRows(w: WorkItem): Node[] {
  const f = w.fields;
  const desc = plain(f['System.Description']);
  return [
    row('circle-outline', t('State'), f['System.State']),
    row('person', t('Assigned to'), f['System.AssignedTo']?.displayName ?? '—'),
    row('calendar', t('Iteration'), f['System.IterationPath']),
    ...(f['Microsoft.VSTS.Common.Priority'] !== undefined ? [row('arrow-up', t('Priority'), String(f['Microsoft.VSTS.Common.Priority']))] : []),
    ...(f['System.Tags'] ? [row('tag', t('Tags'), f['System.Tags'])] : []),
    ...descLines(desc).map((line, i) => row(i ? 'blank' : 'note', line, undefined, { tooltip: desc.slice(0, 1000) })),
    { comments: w },
    row('link-external', t('Show all'), undefined, { command: { command: 'board_azr_devops.preview', title: t('Show all'), arguments: [w] } }),
  ];
}

const TYPE_ICONS: Record<string, string> = { Bug: 'bug', Task: 'tasklist', 'User Story': 'book', 'Product Backlog Item': 'book', Feature: 'star', Epic: 'rocket', Issue: 'issues' };

export class WorkItemTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private children = new Map<number, WorkItem[]>();

  constructor(private readonly model: Model, private readonly activeId: () => number | undefined) {
    model.onDidChange(() => this.changed.fire());
  }

  refresh() { this.changed.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    if ('row' in n) return n.row;
    if ('comments' in n) {
      return Object.assign(new vscode.TreeItem(t('Comments'), vscode.TreeItemCollapsibleState.Collapsed), { iconPath: new vscode.ThemeIcon('comment-discussion') });
    }
    if ('details' in n) {
      return Object.assign(new vscode.TreeItem(t('Details'), vscode.TreeItemCollapsibleState.Collapsed), { iconPath: new vscode.ThemeIcon('info') });
    }
    if ('group' in n) {
      return Object.assign(new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.Expanded), { description: String(n.items.length), id: `group:${n.group}` });
    }
    const f = n.fields;
    const item = new vscode.TreeItem(`#${n.id} ${f['System.Title']}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${f['System.WorkItemType']} · ${f['System.State']}`;
    item.tooltip = `${f['System.TeamProject']} · ${f['System.AssignedTo']?.displayName ?? t('Unassigned')}`;
    const active = this.activeId() === n.id;
    item.iconPath = active
      ? new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon(TYPE_ICONS[f['System.WorkItemType']] ?? 'circle-small');
    if (active) item.description = `${t('current branch')} · ${item.description}`;
    item.contextValue = 'workItem';
    return item;
  }

  async getChildren(n?: Node): Promise<Node[]> {
    if (!n) {
      // Being rendered means the view is visible, so an interactive login is fine now.
      allowLogin();
      if (!this.model.loaded) await this.model.refresh();
      if (!this.model.loaded) await this.model.refresh(); // a silent background load may have been in flight
      return this.roots();
    }
    if ('row' in n) return [];
    if ('details' in n) return detailRows(n.details);
    if ('comments' in n) {
      try { return await commentRows(n.comments); }
      catch (e) { return [row('error', t('Could not load comments'), (e as Error).message)]; }
    }
    if ('group' in n) return n.items;
    // Items with children (hierarchy grouping) get a "Details" node first; others show details directly.
    const kids = this.children.get(n.id) ?? [];
    return kids.length ? [{ details: n }, ...kids] : detailRows(n);
  }

  private roots(): Node[] {
    const items = this.model.visible;
    const by = this.model.groupBy;
    this.children = new Map();
    if (by === 'none') return items;
    if (by === 'hierarchy') {
      const h = hierarchy(items);
      this.children = h.children;
      return h.roots;
    }
    return groupItems(items, by).map(g => ({ group: g.key, items: g.items, label: g.key || (by === 'assignee' ? t('Unassigned') : '—') }));
  }
}
