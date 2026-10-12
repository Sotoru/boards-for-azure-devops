import * as vscode from 'vscode';
import { addComment, getWorkItemFull, isMarkdown, update, WorkItem } from './api';
import { esc } from './text';
import { htmlToMarkdown } from './markdown';

const t = vscode.l10n.t;
export const SCHEME = 'azboards';
type Kind = 'description' | 'comment';

// azboards:/<org>/<project>/<id>/<kind>.md — the URI carries everything needed to write back.
export const editorUri = (w: WorkItem, kind: Kind) => vscode.Uri.from({
  scheme: SCHEME,
  path: `/${encodeURIComponent(w.org)}/${encodeURIComponent(w.fields['System.TeamProject'])}/${w.id}/${kind}.md`,
});

function parse(uri: vscode.Uri): { w: WorkItem; kind: Kind } {
  const [org, project, id, file] = uri.path.split('/').slice(1).map(decodeURIComponent);
  const w = { org, id: Number(id), fields: { 'System.TeamProject': project } } as WorkItem;
  return { w, kind: file.replace(/\.md$/, '') as Kind };
}

/** Markdown → HTML with VS Code's built-in Markdown renderer; escaped text if that extension is disabled. */
export async function renderMarkdown(md: string): Promise<string> {
  try {
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', md);
    if (html) return html;
  } catch { /* fall through */ }
  return esc(md).replace(/\n/g, '<br>');
}

interface Entry { text: Uint8Array; mtime: number; rev?: number; markdown?: boolean }

/** Saving one of these documents sends it to Azure DevOps. A failed save keeps the text in the editor. */
export class WorkItemEditorFs implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private readonly saved = new vscode.EventEmitter<WorkItem>();
  readonly onDidSave = this.saved.event;
  private readonly entries = new Map<string, Entry>();

  stat(uri: vscode.Uri): vscode.FileStat {
    const e = this.entries.get(uri.toString());
    return { type: vscode.FileType.File, ctime: 0, mtime: e?.mtime ?? Date.now(), size: e?.text.byteLength ?? 0 };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const key = uri.toString();
    const { w, kind } = parse(uri);
    if (kind === 'comment') return this.entries.get(key)?.text ?? new Uint8Array();
    const full = await getWorkItemFull(w);
    const markdown = isMarkdown(full, 'System.Description');
    const raw = full.fields['System.Description'] ?? '';
    const text = new TextEncoder().encode(markdown ? raw : htmlToMarkdown(raw));
    this.entries.set(key, { text, mtime: Date.now(), rev: full.rev, markdown });
    return text;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const key = uri.toString();
    const { w, kind } = parse(uri);
    const md = new TextDecoder().decode(content);
    const entry = this.entries.get(key);
    if (kind === 'comment') {
      if (!md.trim()) return;
      await addComment(w, await renderMarkdown(md));
      this.entries.delete(key);
      // Posted: close the tab so a second save can't post the same comment twice.
      const tab = vscode.window.tabGroups.all.flatMap(g => g.tabs)
        .find(tb => tb.input instanceof vscode.TabInputText && tb.input.uri.toString() === key);
      if (tab) setTimeout(() => void vscode.window.tabGroups.close(tab, true), 0);
      vscode.window.setStatusBarMessage(t('Comment posted on #{0}', w.id), 4000);
    } else {
      const value = entry?.markdown ? md : await renderMarkdown(md);
      try {
        const r = await update(w, { 'System.Description': value }, { rev: entry?.rev, markdown: entry?.markdown ? ['System.Description'] : [] });
        this.entries.set(key, { text: content, mtime: Date.now(), rev: (r as { rev?: number }).rev, markdown: entry?.markdown });
      } catch (e) {
        if (/\b(409|412)\b|TF26071|\/rev/i.test((e as Error).message)) {
          throw new Error(t('#{0} was changed by someone else after you opened it. Copy your text, close this tab, reopen the description and paste it again.', w.id));
        }
        throw e;
      }
      vscode.window.setStatusBarMessage(t('Description of #{0} saved', w.id), 4000);
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    this.saved.fire(w);
  }

  /** New comment drafts start empty and live only in memory until saved. */
  openComment(w: WorkItem) {
    const uri = editorUri(w, 'comment');
    if (!this.entries.has(uri.toString())) this.entries.set(uri.toString(), { text: new Uint8Array(), mtime: Date.now() });
    return uri;
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  delete() { throw vscode.FileSystemError.NoPermissions(); }
  rename() { throw vscode.FileSystemError.NoPermissions(); }
}
