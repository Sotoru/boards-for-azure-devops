import * as vscode from 'vscode';
import { getComments, getWorkItem, webUrl, WorkItem } from './api';
import { esc } from './text';

const t = vscode.l10n.t;
export const EDIT_COMMANDS = ['board_azr_devops.setState', 'board_azr_devops.setTitle', 'board_azr_devops.assignMe', 'board_azr_devops.comment'];

// Command URI args go in the link; drop the description so the URL stays small.
const ref = (w: WorkItem): WorkItem => ({ ...w, fields: { ...w.fields, 'System.Description': undefined } });
const cmdLink = (cmd: string, w: WorkItem, label: string) =>
  `<a href="command:${cmd}?${encodeURIComponent(JSON.stringify([ref(w)]))}">${esc(label)}</a>`;

const CSS = `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:0 1rem}th{text-align:left;padding-right:1rem;opacity:.7;vertical-align:top}a{color:var(--vscode-textLink-foreground)}img{max-width:100%}.bar a{margin-right:1rem}.c{border-top:1px solid var(--vscode-panel-border);padding:.5rem 0}`;
// Description/comment HTML comes from Azure DevOps as-is; scripts stay off (webview default) and the CSP blocks everything else.
const page = (body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;">
<style>${CSS}</style></head><body>${body}</body></html>`;

let panel: vscode.WebviewPanel | undefined;
let shown: WorkItem | undefined;
export const shownId = () => shown?.id;

export async function preview(w: WorkItem) {
  const [f, comments] = await Promise.all([getWorkItem(w), getComments(w)]);
  const fresh: WorkItem = { ...w, fields: f };
  if (!panel) {
    // Command URIs limited to our edit commands, so links inside Azure DevOps HTML can't trigger anything else.
    panel = vscode.window.createWebviewPanel('board_azr_devops.preview', '', vscode.ViewColumn.Active, { enableCommandUris: EDIT_COMMANDS });
    panel.onDidDispose(() => (panel = shown = undefined));
  }
  shown = fresh;
  panel.title = `#${w.id} ${f['System.Title']}`;
  const meta = ([
    [t('Type'), f['System.WorkItemType']], [t('State'), f['System.State']],
    [t('Assigned to'), f['System.AssignedTo']?.displayName], [t('Iteration'), f['System.IterationPath']],
    [t('Area'), f['System.AreaPath']], [t('Tags'), f['System.Tags']],
  ] as const).filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const section = (title: string, html?: string) => html ? `<h2>${esc(title)}</h2><div>${html}</div>` : '';
  const commentsHtml = comments.map(c =>
    `<div class="c"><b>${esc(c.createdBy?.displayName)}</b> · ${esc(new Date(c.createdDate).toLocaleString())}<div>${c.text}</div></div>`).join('');
  panel.webview.html = page(`
<h1>#${w.id} ${esc(f['System.Title'])}</h1>
<p class="bar">${cmdLink('board_azr_devops.setState', fresh, t('Change state'))}${cmdLink('board_azr_devops.setTitle', fresh, t('Edit title'))}${cmdLink('board_azr_devops.assignMe', fresh, t('Assign to me'))}${cmdLink('board_azr_devops.comment', fresh, t('Comment'))}<a href="${esc(webUrl(w))}">${esc(t('Open in Azure DevOps'))}</a></p>
<table>${meta}</table>
${section(t('Description'), f['System.Description'])}
${section(t('Acceptance criteria'), f['Microsoft.VSTS.Common.AcceptanceCriteria'])}
${section(t('Repro steps'), f['Microsoft.VSTS.TCM.ReproSteps'])}
<h2>${esc(t('Comments ({0})', comments.length))}</h2>${commentsHtml}`);
  panel.reveal();
}
