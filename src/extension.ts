import * as vscode from 'vscode';
import { addComment, listStates, myIdentity, update, webUrl, WorkItem } from './api';
import { preview, shownId } from './preview';
import { ScopeStore } from './scope';
import { esc } from './text';
import { WorkItemTree } from './tree';

const t = vscode.l10n.t;

// Each edit returns undefined when the user cancels, so nothing gets refreshed.
const edits: Record<string, (w: WorkItem) => Promise<unknown>> = {
  async setState(w) {
    const state = await vscode.window.showQuickPick(listStates(w), { placeHolder: t('Current state: {0}', w.fields['System.State']) });
    return state && update(w, { 'System.State': state });
  },
  async setTitle(w) {
    const title = await vscode.window.showInputBox({ value: w.fields['System.Title'], prompt: t('Title') });
    return title && update(w, { 'System.Title': title });
  },
  async assignMe(w) {
    return update(w, { 'System.AssignedTo': await myIdentity(w.org) });
  },
  async comment(w) {
    const text = await vscode.window.showInputBox({ prompt: t('Comment on #{0}', w.id) });
    return text && addComment(w, esc(text));
  },
};

export function activate(ctx: vscode.ExtensionContext) {
  const scope = new ScopeStore(ctx.globalState);
  const tree = new WorkItemTree(scope);
  const safe = <A extends unknown[]>(fn: (...a: A) => unknown) => (...args: A) =>
    Promise.resolve().then(() => fn(...args)).catch(e => vscode.window.showErrorMessage(`Azure Boards: ${(e as Error).message}`));

  ctx.subscriptions.push(
    scope,
    scope.onDidChange(() => tree.refresh()),
    vscode.window.registerTreeDataProvider('board_azr_devops.mine', tree),
    vscode.commands.registerCommand('board_azr_devops.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('board_azr_devops.switchScope', safe(() => scope.pick())),
    vscode.commands.registerCommand('board_azr_devops.open', (w: WorkItem) => vscode.env.openExternal(vscode.Uri.parse(webUrl(w)))),
    vscode.commands.registerCommand('board_azr_devops.preview', safe(preview)),
    ...Object.entries(edits).map(([name, fn]) => vscode.commands.registerCommand(`board_azr_devops.${name}`, safe(async (w: WorkItem) => {
      if (!(await fn(w))) return;
      tree.refresh();
      if (shownId() === w.id) await preview(w);
    }))),
  );
}
