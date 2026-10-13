import * as vscode from 'vscode';
import { addComment, Commit, getComments, getCommit, getUpdates, getPullRequest, getWorkItemFull, isMarkdown, PullRequest, prUrl, webUrl, WorkItem } from './api';
import { parseArtifactLinks } from './gitText';
import { historyEntries, statePath, WorkItemUpdate } from './historyText';
import { renderMarkdown } from './editorFs';
import { esc } from './text';

const t = vscode.l10n.t;
const ACTIONS: [string, string][] = [
  ['setState', 'Change state'], ['setTitle', 'Edit title'], ['setPriority', 'Priority'], ['setTags', 'Tags'],
  ['assign', 'Assign…'], ['setIteration', 'Sprint'], ['editDescription', 'Edit description'], ['addChild', 'Add child'],
  ['startWork', 'Start working'], ['copyForAi', 'Copy for AI'],
];
export const EDIT_COMMANDS = ACTIONS.map(([c]) => `board_azr_devops.${c}`);

// Command URI args go in the link; drop the long text fields so the URL stays small.
const ref = (w: WorkItem): WorkItem => ({ ...w, fields: {
  ...w.fields, 'System.Description': undefined, 'Microsoft.VSTS.Common.AcceptanceCriteria': undefined, 'Microsoft.VSTS.TCM.ReproSteps': undefined,
} });
const cmdLink = (cmd: string, w: WorkItem, label: string) =>
  `<a href="command:${cmd}?${encodeURIComponent(JSON.stringify([ref(w)]))}">${esc(label)}</a>`;

// Styled after VS Code's own controls: panel tabs, buttons, inputs and the Markdown preview, all from theme colors.
const CSS = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.5;color:var(--vscode-foreground);padding:0 20px 20px;max-width:980px}
h1{font-size:1.6em;font-weight:600;margin:.8em 0 .3em}
h2{font-size:1.15em;font-weight:600;margin:1.4em 0 .5em;padding-bottom:.3em;border-bottom:1px solid var(--vscode-panel-border)}
a{color:var(--vscode-textLink-foreground);text-decoration:none}
a:hover{color:var(--vscode-textLink-activeForeground);text-decoration:underline}
a:focus-visible,button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
img{max-width:100%}
table{border-collapse:collapse}
th{text-align:left;font-weight:normal;padding:2px 16px 2px 0;color:var(--vscode-descriptionForeground);vertical-align:top}
td{padding:2px 0}
.bar a{margin-right:16px;white-space:nowrap;line-height:1.9}
.none,.who,.path small{color:var(--vscode-descriptionForeground)}
.c{border-top:1px solid var(--vscode-panel-border);padding:8px 0}

.tabs{display:flex;gap:4px;margin:12px 0 4px;border-bottom:1px solid var(--vscode-panel-border)}
.tabs button{background:none;color:var(--vscode-panelTitle-inactiveForeground);border:none;border-bottom:1px solid transparent;margin:0 0 -1px;padding:4px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
.tabs button:hover{color:var(--vscode-panelTitle-activeForeground)}
.tabs button[aria-selected=true]{color:var(--vscode-panelTitle-activeForeground);border-bottom-color:var(--vscode-panelTitle-activeBorder)}

textarea{display:block;width:100%;box-sizing:border-box;min-height:5rem;margin-top:12px;resize:vertical;font:inherit;padding:6px 8px;border-radius:2px;
  color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent)}
textarea::placeholder{color:var(--vscode-input-placeholderForeground)}
textarea:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
#post{margin:8px 0;padding:4px 14px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;font:inherit;cursor:pointer;
  background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#post:hover{background:var(--vscode-button-hoverBackground)}
#post:disabled{opacity:.5;cursor:default}
.err{color:var(--vscode-errorForeground);margin-left:8px}

.path{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:12px 0 16px}
.path span{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:9px;padding:0 8px;font-size:.9em}
.path small{margin-left:4px}
.tl{list-style:none;margin:0;padding:0 0 0 16px;border-left:2px solid var(--vscode-panel-border)}
.tl>li{position:relative;padding:0 0 14px 8px}
.tl>li::before{content:'';position:absolute;left:-23px;top:.35em;width:8px;height:8px;border-radius:50%;
  background:var(--vscode-editor-background);border:2px solid var(--vscode-focusBorder)}
.tl ul{margin:2px 0 0;padding-left:16px}
.old{text-decoration:line-through;color:var(--vscode-descriptionForeground)}
`;
// Description/comment HTML comes from Azure DevOps as-is: only our nonce'd script runs, the CSP blocks everything else
// (scripts and inline handlers in that HTML included).
const page = (body: string, nonce: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'nonce-${nonce}';">
<style>${CSS}</style></head><body>${body}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;

// Ctrl/Cmd+Enter posts too. The page re-renders after posting, which clears the box; on error the text stays.
const SCRIPT = `const vscode=acquireVsCodeApi(),box=document.getElementById('new'),btn=document.getElementById('post'),err=document.getElementById('err');
const send=()=>{const text=box.value.trim();if(!text||btn.disabled)return;btn.disabled=true;err.textContent='';vscode.postMessage({type:'comment',text});};
btn.onclick=send;box.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
addEventListener('message',e=>{if(e.data.type==='error'){err.textContent=e.data.text;btn.disabled=false;}});
const show=tab=>{for(const b of document.querySelectorAll('.tabs button')){const on=b.dataset.tab===tab;b.setAttribute('aria-selected',on);document.getElementById('tab-'+b.dataset.tab).hidden=!on;}vscode.setState({tab});};
for(const b of document.querySelectorAll('.tabs button'))b.onclick=()=>show(b.dataset.tab);
show(vscode.getState()?.tab??'details');`;

// Display names for the fields that change most; the rest show their reference name's last part.
const FIELD_LABELS: Record<string, string> = {
  'System.State': 'State', 'System.Reason': 'Reason', 'System.Title': 'Title', 'System.AssignedTo': 'Assigned to',
  'System.IterationPath': 'Iteration', 'System.AreaPath': 'Area', 'System.Tags': 'Tags', 'System.Description': 'Description',
  'Microsoft.VSTS.Common.Priority': 'Priority', 'Microsoft.VSTS.Common.AcceptanceCriteria': 'Acceptance criteria',
  'Microsoft.VSTS.TCM.ReproSteps': 'Repro steps', 'System.BoardColumn': 'Board column', 'System.Parent': 'Parent',
};
const fieldLabel = (f: string) => FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f.endsWith('_Kanban.Column') ? t('Board column') : f.split('.').pop()!;
const date = (iso: string) => new Date(iso).toLocaleString();

function historyHtml(updates: WorkItemUpdate[]) {
  const path = statePath(updates).map(s => `<span>${esc(s.state)}</span><small>${esc(new Date(s.date).toLocaleDateString())}</small>`).join(' → ');
  const entries = historyEntries(updates).map(e => {
    const changes = e.changes.map(c =>
      `<li>${esc(fieldLabel(c.field))}: ${c.from ? `<span class="old">${esc(c.from)}</span> → ` : ''}${c.to ? esc(c.to) : esc(t('(none)'))}</li>`);
    if (e.created) changes.push(`<li>${esc(t('Created'))}</li>`);
    if (e.linksAdded) changes.push(`<li>${esc(t('{0} links added', e.linksAdded))}</li>`);
    if (e.linksRemoved) changes.push(`<li>${esc(t('{0} links removed', e.linksRemoved))}</li>`);
    return `<li><b>${esc(e.by)}</b> <span class="who">· ${esc(date(e.date))}</span><ul>${changes.join('')}</ul></li>`;
  }).join('');
  return `${path ? `<div class="path">${path}</div>` : ''}<ul class="tl">${entries}</ul>`;
}

const MAX_LINKS = 10;
const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps).then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? [r.value] : [])));

/** Linked pull requests and commits; ones that fail to load (deleted repo, no access) are skipped. */
async function linkedDev(org: string, relations: { rel: string; url: string }[] | undefined) {
  const links = parseArtifactLinks(relations);
  const [prs, commits] = await Promise.all([
    settle<PullRequest>(links.filter(l => l.kind === 'pr').slice(0, MAX_LINKS).map(l => getPullRequest(org, l.repoId, l.key))),
    settle<Commit>(links.filter(l => l.kind === 'commit').slice(0, MAX_LINKS).map(l => getCommit(org, l.projectId, l.repoId, l.key))),
  ]);
  const prHtml = prs.map(pr => `<li><a href="${esc(prUrl(org, pr))}">!${pr.pullRequestId} ${esc(pr.title)}</a> · ${esc(pr.isDraft ? t('draft') : pr.status)} · ${esc(pr.repository.name)}</li>`).join('');
  const commitHtml = commits.map(c => {
    const label = `${c.commitId.slice(0, 8)} ${esc(c.comment.split('\n')[0])}`;
    return `<li>${c.remoteUrl ? `<a href="${esc(c.remoteUrl)}">${label}</a>` : label} · ${esc(c.author?.name)}</li>`;
  }).join('');
  return [
    prHtml && `<h2>${esc(t('Pull requests'))}</h2><ul>${prHtml}</ul>`,
    commitHtml && `<h2>${esc(t('Commits'))}</h2><ul>${commitHtml}</ul>`,
  ].join('');
}

let panel: vscode.WebviewPanel | undefined;
let shown: WorkItem | undefined;
export const shownId = () => shown?.id;

export async function preview(w: WorkItem) {
  const [full, comments, updates] = await Promise.all([getWorkItemFull(w), getComments(w), getUpdates(w)]);
  const f = full.fields;
  // Markdown fields come back as raw Markdown; render them like the HTML ones.
  const html = async (field: 'System.Description' | 'Microsoft.VSTS.Common.AcceptanceCriteria' | 'Microsoft.VSTS.TCM.ReproSteps') =>
    f[field] && isMarkdown(full, field) ? renderMarkdown(f[field]!) : f[field];
  const [description, criteria, repro] = await Promise.all([
    html('System.Description'), html('Microsoft.VSTS.Common.AcceptanceCriteria'), html('Microsoft.VSTS.TCM.ReproSteps'),
  ]);
  const fresh: WorkItem = { ...w, fields: f };
  const dev = await linkedDev(w.org, full.relations);
  if (!panel) {
    // Command URIs limited to our edit commands, so links inside Azure DevOps HTML can't trigger anything else.
    panel = vscode.window.createWebviewPanel('board_azr_devops.preview', '', vscode.ViewColumn.Active, { enableCommandUris: EDIT_COMMANDS, enableScripts: true });
    panel.onDidDispose(() => (panel = shown = undefined));
    panel.webview.onDidReceiveMessage(async (m: { type: 'comment'; text: string }) => {
      const target = shown;
      if (m.type !== 'comment' || !target) return;
      try {
        await addComment(target, await renderMarkdown(m.text));
        vscode.window.setStatusBarMessage(t('Comment posted on #{0}', target.id), 4000);
        await preview(target);
      } catch (e) {
        void panel?.webview.postMessage({ type: 'error', text: (e as Error).message });
      }
    });
  }
  shown = fresh;
  panel.title = `#${w.id}`;
  const meta = ([
    [t('ID'), `#${w.id}`], [t('Type'), f['System.WorkItemType']], [t('State'), f['System.State']],
    [t('Assigned to'), f['System.AssignedTo']?.displayName], [t('Iteration'), f['System.IterationPath']],
    [t('Priority'), f['Microsoft.VSTS.Common.Priority']?.toString()], [t('Area'), f['System.AreaPath']], [t('Tags'), f['System.Tags']],
  ] as const).filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const section = (title: string, html?: string) => html ? `<h2>${esc(title)}</h2><div>${html}</div>` : '';
  const commentsHtml = comments.map(c =>
    `<div class="c"><b>${esc(c.createdBy?.displayName)}</b> · ${esc(new Date(c.createdDate).toLocaleString())}<div>${c.renderedText ?? c.text}</div></div>`).join('');
  panel.webview.html = page(`
<h1>${esc(f['System.Title'])}</h1>
<p class="bar">${ACTIONS.map(([c, label]) => cmdLink(`board_azr_devops.${c}`, fresh, t(label))).join('')}<a href="${esc(webUrl(w))}">${esc(t('Open in Azure DevOps'))}</a></p>
<div class="tabs" role="tablist"><button role="tab" data-tab="details">${esc(t('Details'))}</button><button role="tab" data-tab="history">${esc(t('History'))} (${historyEntries(updates).length})</button></div>
<section id="tab-details" role="tabpanel">
<table>${meta}</table>
${section(t('Description'), description)}
${section(t('Acceptance criteria'), criteria)}
${section(t('Repro steps'), repro)}
<h2>${esc(t('Comments ({0})', comments.length))}</h2>${commentsHtml || `<p class="none">${esc(t('No comments'))}</p>`}
<textarea id="new" placeholder="${esc(t('Add a comment (Markdown). Ctrl/Cmd+Enter to post.'))}"></textarea>
<button id="post">${esc(t('Comment'))}</button> <span id="err" class="err"></span>
${dev}
</section>
<section id="tab-history" role="tabpanel" hidden>${historyHtml(updates)}</section>`, [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
  panel.reveal();
}
