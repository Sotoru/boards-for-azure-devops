import * as vscode from 'vscode';
import { listQueries, runQuery, SavedQuery, WorkItem } from './api';
import { Model } from './model';
import { detailRows, Row, row, workItemTreeItem } from './tree';

type Node = SavedQuery | WorkItem | Row;
const t = vscode.l10n.t;

/** Saved queries (My Queries, Shared Queries) of the scope's project; expanding a query runs it. */
export class QueryTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  // Model refreshes (polling, edits, scope switch) re-run the expanded queries.
  constructor(private readonly model: Model, private readonly activeId: () => number | undefined) {
    model.onDidChange(() => this.changed.fire());
  }

  refresh() { this.changed.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    if ('row' in n) return n.row;
    if ('fields' in n) return workItemTreeItem(n, this.activeId());
    const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `query:${n.id}`;
    item.iconPath = new vscode.ThemeIcon(n.isFolder ? 'folder' : 'search');
    if (n.isFolder && !n.hasChildren) item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    return item;
  }

  async getChildren(n?: Node): Promise<Node[]> {
    if (n && 'row' in n) return [];
    if (n && 'fields' in n) return detailRows(n);
    const { org, project, team } = this.model.scope.current;
    if (!org || !project) {
      return [row('info', t('Pick a project and team (status bar)'), undefined, { command: { command: 'board_azr_devops.switchScope', title: '' } })];
    }
    try {
      if (!n) return await listQueries(org, project);
      if (n.isFolder) return n.children ?? await listQueries(org, project, n.id);
      const items = await runQuery(org, project, team, n.id);
      return items.length ? items : [row('circle-slash', t('No items'))];
    } catch (e) {
      // A thrown error would leave the node silently empty.
      return [row('error', (e as Error).message, undefined, { tooltip: (e as Error).message })];
    }
  }
}
