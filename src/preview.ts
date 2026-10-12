import * as vscode from 'vscode';
import { getComments, getWorkItemFull, isMarkdown, webUrl, WorkItem } from './api';
import { renderMarkdown } from './editorFs';
import { esc } from './text';

const t = vscode.l10n.t;
const ACTIONS: [string, string][] = [
  ['setState', 'Change state'], ['setTitle', 'Edit title'], ['setPriority', 'Priority'], ['setTags', 'Tags'],
  ['assign', 'Assign…'], ['setIteration', 'Sprint'], ['editDescription', 'Edit description'], ['comment', 'Comment'], ['addChild', 'Add child'],
];
export const EDIT_COMMANDS = ACTIONS.map(([c]) => `board_azr_devops.${c}`);

// Command URI args go in the link; drop the long text fields so the URL stays small.
const ref = (w: WorkItem): WorkItem => ({ ...w, fields: {
  ...w.fields, 'System.Description': undefined, 'Microsoft.VSTS.Common.AcceptanceCriteria': undefined, 'Microsoft.VSTS.TCM.ReproSteps': undefined,
} });
const cmdLink = (cmd: string, w: WorkItem, label: string) =>
  `<a href="command:${cmd}?${encodeURIComponent(JSON.stringify([ref(w)]))}">${esc(label)}</a>`;

const CSS = `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:0 1rem}th{text-align:left;padding-right:1rem;opacity:.7;vertical-align:top}a{color:var(--vscode-textLink-foreground)}img{max-width:100%}.bar a{margin-right:1rem;white-space:nowrap;line-height:1.8}.c{border-top:1px solid var(--vscode-panel-border);padding:.5rem 0}`;
// Description/comment HTML comes from Azure DevOps as-is; scripts stay off (webview default) and the CSP blocks everything else.
const page = (body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;">
<style>${CSS}</style></head><body>${body}</body></html>`;

let panel: vscode.WebviewPanel | undefined;
let shown: WorkItem | undefined;
export const shownId = () => shown?.id;

export async function preview(w: WorkItem) {
  const [full, comments] = await Promise.all([getWorkItemFull(w), getComments(w)]);
  const f = full.fields;
  // Markdown fields come back as raw Markdown; render them like the HTML ones.
  const html = async (field: 'System.Description' | 'Microsoft.VSTS.Common.AcceptanceCriteria' | 'Microsoft.VSTS.TCM.ReproSteps') =>
    f[field] && isMarkdown(full, field) ? renderMarkdown(f[field]!) : f[field];
  const [description, criteria, repro] = await Promise.all([
    html('System.Description'), html('Microsoft.VSTS.Common.AcceptanceCriteria'), html('Microsoft.VSTS.TCM.ReproSteps'),
  ]);
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
    [t('Priority'), f['Microsoft.VSTS.Common.Priority']?.toString()], [t('Area'), f['System.AreaPath']], [t('Tags'), f['System.Tags']],
  ] as const).filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const section = (title: string, html?: string) => html ? `<h2>${esc(title)}</h2><div>${html}</div>` : '';
  const commentsHtml = comments.map(c =>
    `<div class="c"><b>${esc(c.createdBy?.displayName)}</b> · ${esc(new Date(c.createdDate).toLocaleString())}<div>${c.renderedText ?? c.text}</div></div>`).join('');
  panel.webview.html = page(`
<h1>#${w.id} ${esc(f['System.Title'])}</h1>
<p class="bar">${ACTIONS.map(([c, label]) => cmdLink(`board_azr_devops.${c}`, fresh, t(label))).join('')}<a href="${esc(webUrl(w))}">${esc(t('Open in Azure DevOps'))}</a></p>
<table>${meta}</table>
${section(t('Description'), description)}
${section(t('Acceptance criteria'), criteria)}
${section(t('Repro steps'), repro)}
<h2>${esc(t('Comments ({0})', comments.length))}</h2>${commentsHtml}`);
  panel.reveal();
}
