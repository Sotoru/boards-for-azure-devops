import * as vscode from 'vscode';
import { addComment, Commit, getComments, getCommit, getUpdates, getPullRequest, getWorkItemFull, isMarkdown, PullRequest, prUrl, stateColors, typeColors, webUrl, WorkItem } from './api';
import { parseArtifactLinks } from './gitText';
import { historyEntries, statePath, WorkItemUpdate } from './historyText';
import { renderMarkdown } from './editorFs';
import { esc } from './text';

const t = vscode.l10n.t;
// Actions that don't edit a field; fields are edited by clicking them.
const ACTIONS: [string, string][] = [['startWork', 'Start working'], ['copyForAi', 'Copy for AI'], ['addChild', 'Add child']];
const EDIT_COMMANDS = ['setState', 'setTitle', 'setPriority', 'setTags', 'assign', 'setIteration', 'editDescription', ...ACTIONS.map(([c]) => c)]
  .map(c => `board_azr_devops.${c}`);

// Command URI args go in the link; drop the long text fields so the URL stays small.
const ref = (w: WorkItem): WorkItem => ({ ...w, fields: {
  ...w.fields, 'System.Description': undefined, 'Microsoft.VSTS.Common.AcceptanceCriteria': undefined, 'Microsoft.VSTS.TCM.ReproSteps': undefined,
} });
const cmdHref = (cmd: string, w: WorkItem) => `command:board_azr_devops.${cmd}?${encodeURIComponent(JSON.stringify([ref(w)]))}`;
const cmdLink = (cmd: string, w: WorkItem, label: string) => `<a href="${cmdHref(cmd, w)}">${esc(label)}</a>`;
/** A value that opens its editor on click; `html` is already escaped. */
const editable = (cmd: string, w: WorkItem, html: string, title: string) =>
  `<a class="edit" href="${cmdHref(cmd, w)}" title="${esc(title)}">${html}</a>`;

// Styled after VS Code's own controls: panel tabs, buttons, inputs and the Markdown preview, all from theme colors.
const CSS = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.5;color:var(--vscode-foreground);padding:0 20px 20px;max-width:1100px}
h1{font-size:1.6em;font-weight:600;line-height:1.25;text-wrap:balance;margin:.2em 0 .4em}
h2{font-size:1.15em;font-weight:600;margin:1.4em 0 .5em;padding-bottom:.3em;border-bottom:1px solid var(--vscode-panel-border)}
a{color:var(--vscode-textLink-foreground);text-decoration:none}
a:hover{color:var(--vscode-textLink-activeForeground);text-decoration:underline}
a:focus-visible,button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
img{max-width:100%}
code,pre,kbd{font-family:var(--vscode-editor-font-family);font-size:.9em;background:var(--vscode-textCodeBlock-background);border-radius:3px}
code,kbd{padding:1px 4px}
pre{padding:8px 12px;overflow:auto}
pre code{background:none;padding:0;font-size:1em}
.md *{font-family:inherit!important}
.md :is(code,pre,pre *,kbd){font-family:var(--vscode-editor-font-family)!important}
.md :is(p,li,blockquote,h1,h2,h3,h4,h5,h6),.md div:not(:has(table,img,pre)){max-width:80ch}
.who,.kind,.path small{font-variant-numeric:tabular-nums}
table{border-collapse:collapse}
th{text-align:left;font-weight:normal;padding:2px 16px 2px 0;color:var(--vscode-descriptionForeground);vertical-align:top}
td{padding:2px 0}
header{margin:16px 0 0;padding-left:12px;border-left:4px solid var(--type,var(--vscode-panel-border))}
.kind{display:flex;gap:10px;align-items:center;color:var(--vscode-descriptionForeground)}
.kind b{color:var(--vscode-foreground);font-weight:600}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:var(--dot,var(--vscode-descriptionForeground))}
.bar{margin:0}
.bar a{margin-right:16px;white-space:nowrap;line-height:1.9}
.edit{color:inherit;border-radius:2px;padding:0 4px;margin:0 -4px}
.edit:hover{color:inherit;text-decoration:none;background:var(--vscode-list-hoverBackground)}
.edit:hover::after{content:' ✎';opacity:.6}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:32px;align-items:start}
@media (max-width:700px){.grid{grid-template-columns:minmax(0,1fr);gap:0}aside{order:-1}}
dl{margin:12px 0 0}
dt{color:var(--vscode-descriptionForeground);font-size:.9em;margin-top:10px}
dd{margin:0}
dd .edit{display:block}
.chip{display:inline-block;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:9px;padding:0 8px;margin:2px 4px 2px 0;font-size:.9em}
aside h2{font-size:.9em;font-weight:normal;color:var(--vscode-descriptionForeground);border:none;margin:16px 0 0;padding:0}
aside ul{list-style:none;padding:0;margin:0}
aside li{margin:2px 0}
.none,.who,.path small,.loading{color:var(--vscode-descriptionForeground)}
.c{border-top:1px solid var(--vscode-panel-border);padding:8px 0}

.tabs{display:flex;gap:4px;margin:16px 0 4px;border-bottom:1px solid var(--vscode-panel-border)}
.tabs button{background:none;color:var(--vscode-panelTitle-inactiveForeground);border:none;border-bottom:1px solid transparent;margin:0 0 -1px;padding:4px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
.tabs button:hover{color:var(--vscode-panelTitle-activeForeground)}
.tabs button[aria-selected=true]{color:var(--vscode-panelTitle-activeForeground);border-bottom-color:var(--vscode-panelTitle-activeBorder)}

textarea{display:block;width:100%;box-sizing:border-box;min-height:5rem;margin-top:16px;resize:vertical;font:inherit;padding:6px 8px;border-radius:2px;
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
const page = (body: string, id: number, nonce?: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'nonce-${nonce}';">
<style>${CSS}</style></head><body data-id="${id}">${body}${nonce ? `<script nonce="${nonce}">${SCRIPT}</script>` : ''}</body></html>`;

// Every edit re-renders the page, so the tab, scroll position and comment draft live in the webview state and come back.
// Scroll and draft belong to one work item; the tab carries over. Ctrl/Cmd+Enter posts. The draft is dropped from the
// state when posting (the page re-renders on success) and put back on error.
const SCRIPT = `const vscode=acquireVsCodeApi(),box=document.getElementById('new'),btn=document.getElementById('post'),err=document.getElementById('err');
const id=document.body.dataset.id,old=vscode.getState()??{},st={tab:old.tab??'details',id,y:0,draft:''};
if(old.id===id){st.y=old.y??0;st.draft=old.draft??'';}
const save=()=>vscode.setState(st);
box.value=st.draft;box.oninput=()=>{st.draft=box.value;save();};
const send=()=>{const text=box.value.trim();if(!text||btn.disabled)return;btn.disabled=true;err.textContent='';st.draft='';save();vscode.postMessage({type:'comment',text});};
btn.onclick=send;box.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
addEventListener('message',e=>{if(e.data.type==='error'){err.textContent=e.data.text;btn.disabled=false;st.draft=box.value;save();}});
const show=tab=>{for(const b of document.querySelectorAll('.tabs button')){const on=b.dataset.tab===tab;b.setAttribute('aria-selected',on);document.getElementById('tab-'+b.dataset.tab).hidden=!on;}st.tab=tab;save();};
for(const b of document.querySelectorAll('.tabs button'))b.onclick=()=>show(b.dataset.tab);
show(st.tab);scrollTo(0,st.y);addEventListener('scroll',()=>{st.y=scrollY;save();},{passive:true});`;

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

function ensurePanel() {
  if (panel) return panel;
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
  return panel;
}

export async function preview(w: WorkItem) {
  const p = ensurePanel();
  // Opening another item shows a placeholder at once; re-rendering the same one keeps the old page until the new is ready.
  const switching = shown?.id !== w.id;
  if (switching) {
    shown = undefined;
    p.title = `#${w.id}`;
    p.webview.html = page(`<p class="loading">${esc(t('Loading…'))}</p>`, w.id);
    p.reveal();
  }
  try {
    await render(p, w);
  } catch (e) {
    if (switching) p.webview.html = page(`<p class="err">${esc((e as Error).message)}</p>`, w.id);
    throw e;
  }
}

async function render(p: vscode.WebviewPanel, w: WorkItem) {
  const fullP = getWorkItemFull(w);
  const none = () => ({} as Record<string, string>);
  const [full, comments, updates, dev, types, states] = await Promise.all([
    fullP, getComments(w), getUpdates(w), fullP.then(x => linkedDev(w.org, x.relations)),
    typeColors(w.org, w.fields['System.TeamProject']).catch(none), stateColors(w).catch(none),
  ]);
  const f = full.fields;
  // Markdown fields come back as raw Markdown; render them like the HTML ones.
  const html = async (field: 'System.Description' | 'Microsoft.VSTS.Common.AcceptanceCriteria' | 'Microsoft.VSTS.TCM.ReproSteps') =>
    f[field] && isMarkdown(full, field) ? renderMarkdown(f[field]!) : f[field];
  const [description, criteria, repro] = await Promise.all([
    html('System.Description'), html('Microsoft.VSTS.Common.AcceptanceCriteria'), html('Microsoft.VSTS.TCM.ReproSteps'),
  ]);
  const fresh: WorkItem = { ...w, fields: f };
  shown = fresh;
  p.title = `#${w.id}`;

  const type = f['System.WorkItemType'], state = f['System.State'];
  const color = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '');
  const placeholder = (s: string) => `<span class="none">${esc(s)}</span>`;
  const tags = f['System.Tags']?.split(';').map(s => s.trim()).filter(Boolean) ?? [];
  const fields = ([
    [t('Assigned to'), 'assign', f['System.AssignedTo']?.displayName, t('Unassigned')],
    [t('Iteration'), 'setIteration', f['System.IterationPath'], t('No iteration')],
    [t('Priority'), 'setPriority', f['Microsoft.VSTS.Common.Priority']?.toString(), t('No priority')],
  ] as const).map(([label, cmd, v, empty]) => `<dt>${esc(label)}</dt><dd>${editable(cmd, fresh, v ? esc(v) : placeholder(empty), label)}</dd>`).join('')
    + `<dt>${esc(t('Tags'))}</dt><dd>${editable('setTags', fresh, tags.map(s => `<span class="chip">${esc(s)}</span>`).join('') || placeholder(t('No tags')), t('Tags'))}</dd>`
    + (f['System.AreaPath'] ? `<dt>${esc(t('Area'))}</dt><dd>${esc(f['System.AreaPath'])}</dd>` : '');

  const section = (title: string, html?: string) => html ? `<h2>${esc(title)}</h2><div class="md">${html}</div>` : '';
  const commentsHtml = [...comments].sort((a, b) => b.createdDate.localeCompare(a.createdDate)).map(c =>
    `<div class="c"><b>${esc(c.createdBy?.displayName)}</b> <span class="who">· ${esc(new Date(c.createdDate).toLocaleString())}</span><div class="md">${c.renderedText ?? c.text}</div></div>`).join('');
  const tab = (id: string, label: string) => `<button role="tab" data-tab="${id}">${esc(label)}</button>`;

  p.webview.html = page(`
<header style="--type:${color(types[type]) || 'var(--vscode-panel-border)'}">
<div class="kind"><b>${esc(type)}</b><span>#${w.id}</span>${editable('setState', fresh, `<span class="dot" style="--dot:${color(states[state]) || 'var(--vscode-descriptionForeground)'}"></span>${esc(state)}`, t('Change state'))}</div>
<h1>${editable('setTitle', fresh, esc(f['System.Title']), t('Edit title'))}</h1>
<p class="bar">${ACTIONS.map(([c, label]) => cmdLink(c, fresh, t(label))).join('')}<a href="${esc(webUrl(w))}">${esc(t('Open in Azure DevOps'))}</a></p>
</header>
<div class="grid">
<main>
<div class="tabs" role="tablist">${tab('details', t('Details'))}${tab('comments', t('Comments ({0})', comments.length))}${tab('history', `${t('History')} (${historyEntries(updates).length})`)}</div>
<section id="tab-details" role="tabpanel">
<h2>${editable('editDescription', fresh, esc(t('Description')), t('Edit description'))}</h2>
<div class="md">${description || `<p>${editable('editDescription', fresh, placeholder(t('Add description')), t('Edit description'))}</p>`}</div>
${section(t('Acceptance criteria'), criteria)}
${section(t('Repro steps'), repro)}
</section>
<section id="tab-comments" role="tabpanel" hidden>
<textarea id="new" placeholder="${esc(t('Add a comment (Markdown). Ctrl/Cmd+Enter to post.'))}"></textarea>
<button id="post">${esc(t('Comment'))}</button> <span id="err" class="err"></span>
${commentsHtml || `<p class="none">${esc(t('No comments'))}</p>`}
</section>
<section id="tab-history" role="tabpanel" hidden>${historyHtml(updates)}</section>
</main>
<aside><dl>${fields}</dl>${dev}</aside>
</div>`, w.id, [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
  if (!p.visible) p.reveal();
}
