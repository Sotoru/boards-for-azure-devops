import * as vscode from 'vscode';
import { allowLogin, WorkItem } from './api';
import { groupItems, hierarchy } from './filters';
import { Model } from './model';
import { descLines, plain } from './text';

type Row = { row: vscode.TreeItem };
type GroupNode = { group: string; label: string; items: WorkItem[] };
type DetailsNode = { details: WorkItem };
// WorkItem nodes are the work items themselves, so context-menu commands receive a WorkItem directly.
type Node = WorkItem | GroupNode | DetailsNode | Row;
const t = vscode.l10n.t;

function row(icon: string, label: string, description?: string, extra: Partial<vscode.TreeItem> = {}): Row {
  return { row: Object.assign(new vscode.TreeItem(label), { iconPath: new vscode.ThemeIcon(icon), description }, extra) };
}

function detailRows(w: WorkItem): Row[] {
  const f = w.fields;
  const desc = plain(f['System.Description']);
  return [
    row('circle-outline', t('State'), f['System.State']),
    row('person', t('Assigned to'), f['System.AssignedTo']?.displayName ?? '—'),
    row('calendar', t('Iteration'), f['System.IterationPath']),
    ...(f['Microsoft.VSTS.Common.Priority'] !== undefined ? [row('arrow-up', t('Priority'), String(f['Microsoft.VSTS.Common.Priority']))] : []),
    ...(f['System.Tags'] ? [row('tag', t('Tags'), f['System.Tags'])] : []),
    ...descLines(desc).map((line, i) => row(i ? 'blank' : 'note', line, undefined, { tooltip: desc.slice(0, 1000) })),
    row('link-external', t('Show all'), undefined, { command: { command: 'board_azr_devops.preview', title: t('Show all'), arguments: [w] } }),
  ];
}

const TYPE_ICONS: Record<string, string> = { Bug: 'bug', Task: 'tasklist', 'User Story': 'book', 'Product Backlog Item': 'book', Feature: 'star', Epic: 'rocket', Issue: 'issues' };

export class WorkItemTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private children = new Map<number, WorkItem[]>();

  constructor(private readonly model: Model) {
    model.onDidChange(() => this.changed.fire());
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if ('row' in n) return n.row;
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
    item.iconPath = new vscode.ThemeIcon(TYPE_ICONS[f['System.WorkItemType']] ?? 'circle-small');
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
