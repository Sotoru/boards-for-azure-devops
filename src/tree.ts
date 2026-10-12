import * as vscode from 'vscode';
import { allowLogin, WorkItem } from './api';
import { groupItems, hierarchy } from './filters';
import { Model } from './model';
import { plain } from './text';

/** `copy` is the value the "Copy" action puts on the clipboard. */
export type Row = { row: vscode.TreeItem; copy?: string };
type GroupNode = { group: string; label: string; items: WorkItem[] };
type DetailsNode = { details: WorkItem };
// WorkItem nodes are the work items themselves, so context-menu commands receive a WorkItem directly.
type Node = WorkItem | GroupNode | DetailsNode | Row;
const t = vscode.l10n.t;

function row(icon: string, label: string, description?: string, extra: Partial<vscode.TreeItem> = {}): Row {
  return { row: Object.assign(new vscode.TreeItem(label), { iconPath: new vscode.ThemeIcon(icon), description }, extra) };
}

/** A label/value row whose value can be copied (inline icon and context menu). */
function field(icon: string, label: string, value: string | undefined, shown = value, extra: Partial<vscode.TreeItem> = {}): Row {
  const r = row(icon, label, shown ?? '—', { contextValue: value ? 'field' : undefined, ...extra });
  return { ...r, copy: value };
}

const DESC_PREVIEW = 80;

function detailRows(w: WorkItem): Row[] {
  const f = w.fields;
  const desc = plain(f['System.Description']);
  return [
    field('symbol-number', t('ID'), String(w.id), `#${w.id}`),
    field('symbol-text', t('Title'), f['System.Title']),
    field('circle-outline', t('State'), f['System.State']),
    field('person', t('Assigned to'), f['System.AssignedTo']?.displayName),
    field('calendar', t('Iteration'), f['System.IterationPath']),
    ...(f['Microsoft.VSTS.Common.Priority'] !== undefined ? [field('arrow-up', t('Priority'), String(f['Microsoft.VSTS.Common.Priority']))] : []),
    ...(f['System.Tags'] ? [field('tag', t('Tags'), f['System.Tags'])] : []),
    ...(desc ? [field('note', t('Description'), desc, desc.length > DESC_PREVIEW ? `${desc.slice(0, DESC_PREVIEW)}…` : desc, { tooltip: desc.slice(0, 1000) })] : []),
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
    if ('details' in n) {
      return Object.assign(new vscode.TreeItem(t('Details'), vscode.TreeItemCollapsibleState.Collapsed), { iconPath: new vscode.ThemeIcon('info') });
    }
    if ('group' in n) {
      return Object.assign(new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.Expanded), { description: String(n.items.length), id: `group:${n.group}` });
    }
    const f = n.fields;
    const item = new vscode.TreeItem(f['System.Title'], vscode.TreeItemCollapsibleState.Collapsed);
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
