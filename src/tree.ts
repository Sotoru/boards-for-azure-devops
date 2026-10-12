import * as vscode from 'vscode';
import { fetchMine, WorkItem } from './api';
import { ScopeStore } from './scope';
import { descLines, plain } from './text';

type Row = { row: vscode.TreeItem };
type Node = WorkItem | Row;
const isRow = (n: Node): n is Row => 'row' in n;
const t = vscode.l10n.t;

function row(icon: string, label: string, description?: string, extra: Partial<vscode.TreeItem> = {}): Row {
  return { row: Object.assign(new vscode.TreeItem(label), { iconPath: new vscode.ThemeIcon(icon), description }, extra) };
}

// Rows shown when a work item is expanded.
function detailRows(w: WorkItem): Row[] {
  const f = w.fields;
  const desc = plain(f['System.Description']);
  return [
    row('circle-outline', t('State'), f['System.State']),
    row('person', t('Assigned to'), f['System.AssignedTo']?.displayName ?? '—'),
    row('calendar', t('Iteration'), f['System.IterationPath']),
    ...(f['System.Tags'] ? [row('tag', t('Tags'), f['System.Tags'])] : []),
    ...descLines(desc).map((line, i) => row(i ? 'blank' : 'note', line, undefined, { tooltip: desc.slice(0, 1000) })),
    row('link-external', t('Show all'), undefined, { command: { command: 'board_azr_devops.preview', title: t('Show all'), arguments: [w] } }),
  ];
}

export class WorkItemTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly scope: ScopeStore) {}

  refresh() { this.changed.fire(); }

  getTreeItem(n: Node) {
    if (isRow(n)) return n.row;
    const f = n.fields;
    const item = new vscode.TreeItem(`#${n.id} ${f['System.Title']}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${f['System.WorkItemType']} · ${f['System.State']}`;
    item.tooltip = f['System.TeamProject'];
    item.contextValue = 'workItem';
    return item;
  }

  async getChildren(n?: Node): Promise<Node[]> {
    if (n) return isRow(n) ? [] : detailRows(n);
    const { org } = this.scope.current;
    if (!org) return []; // empty tree shows the viewsWelcome "Choose organization" link
    try { return await fetchMine(org); }
    catch (e) { vscode.window.showErrorMessage(`Azure Boards: ${(e as Error).message}`); return []; }
  }
}
