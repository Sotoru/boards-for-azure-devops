import * as vscode from 'vscode';
import { fetchByTeamQuery, getBoard, getTeamField, listBoards, typeColors, update, WorkItem } from './api';
import { Board, boardQuery, columnOf, initials, targetState } from './boardLogic';
import type { BoardData, FromWebview, ToWebview } from './boardMessages';
import { pickFilters } from './filterPick';
import { activeFilterCount, applyFilters, valuesOf } from './filters';
import { Model } from './model';
import { preview } from './preview';

const t = vscode.l10n.t;
// ponytail: requirement-level board names of the default processes; otherwise the last board (lowest backlog level).
const REQUIREMENT_BOARDS = ['Stories', 'Backlog items', 'Requirements', 'Issues'];

/** Kanban of the scope's team in an editor tab. One panel, reused. */
export class BoardPanel {
  private panel?: vscode.WebviewPanel;
  private board?: Board;
  private items: WorkItem[] = [];
  private loading?: Promise<void>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: vscode.Memento,
    private readonly model: Model,
    private readonly activeId: () => number | undefined,
  ) {
    model.onDidChange(() => { if (this.panel) void this.load(); });
  }

  show() {
    if (this.panel) { this.panel.reveal(); return void this.load(); }
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel('board_azr_devops.board', t('Board'), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const csp = `default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    this.panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${CSS}</style></head><body><div id="root"><p class="message">${t('Loading…')}</p></div>
<script nonce="${nonce}" src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'board.js'))}"></script></body></html>`;
    this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    this.panel.onDidDispose(() => { this.panel = undefined; });
  }

  private post(m: ToWebview) { void this.panel?.webview.postMessage(m); }

  private boardKey() {
    const { org, project, team } = this.model.scope.current;
    return `board:${org}/${project}/${team}`;
  }

  load(): Promise<void> {
    this.loading ??= this.doLoad().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async doLoad() {
    const { org, project, team } = this.model.scope.current;
    if (!org || !project || !team) {
      this.post({ type: 'message', text: t('Pick a project and team (status bar) to see the board.') });
      return;
    }
    this.post({ type: 'busy', on: true });
    try {
      const boards = await listBoards(org, project, team);
      const saved = this.state.get<string>(this.boardKey());
      const chosen = boards.find(b => b.id === saved)
        ?? boards.find(b => REQUIREMENT_BOARDS.includes(b.name)) ?? boards[boards.length - 1];
      if (!chosen) throw new Error(t('No boards found for team {0}', team));
      const filters = this.model.filtersFor('all');
      const [board, field, colors] = await Promise.all([getBoard(org, project, team, chosen.id), getTeamField(org, project, team), typeColors(org, project)]);
      const columnField = board.fields.columnField.referenceName;
      this.board = board;
      this.items = await fetchByTeamQuery(org, project, team, boardQuery(field, board, filters.currentSprint), [columnField]);
      const visible = applyFilters(this.items, filters);
      const n = activeFilterCount(filters);
      const data: BoardData = {
        title: `${team} · ${board.name}`,
        summary: [String(visible.length), n ? t('{0} filters', n) : '', filters.currentSprint ? t('current sprint') : ''].filter(Boolean).join(' · '),
        boards,
        board: chosen.id,
        columns: board.columns.map(c => ({ name: c.name, limit: c.itemLimit, accepts: Object.keys(c.stateMappings) })),
        cards: visible.map(w => ({
          id: w.id,
          title: w.fields['System.Title'],
          type: w.fields['System.WorkItemType'],
          color: colors[w.fields['System.WorkItemType']] ?? '',
          column: columnOf(board, w.fields as unknown as Record<string, unknown>),
          assignee: w.fields['System.AssignedTo']?.displayName,
          initials: initials(w.fields['System.AssignedTo']?.displayName),
          tags: valuesOf(w, 'tags'),
          active: w.id === this.activeId(),
        })),
        labels: {
          filter: t('Filter…'), refresh: t('Refresh'), empty: t('No items'), unassigned: t('Unassigned'), board: t('Board'),
          moveHint: t('Drag to another column, or Alt+←/→. Enter opens.'),
        },
      };
      if (this.panel) this.panel.title = `${t('Board')}: ${team}`;
      this.post({ type: 'data', data });
    } catch (e) {
      this.post({ type: 'message', text: (e as Error).message });
    } finally {
      this.post({ type: 'busy', on: false });
    }
  }

  private async onMessage(m: FromWebview) {
    try {
      switch (m.type) {
        case 'ready': return await this.load();
        case 'refresh': return await this.model.refresh(); // reloads the board through onDidChange
        case 'filter': return await pickFilters(this.model, 'all', this.items);
        case 'selectBoard': await this.state.update(this.boardKey(), m.id); return await this.load();
        case 'open': {
          const w = this.items.find(i => i.id === m.id);
          return w && await preview(w);
        }
        case 'move': return await this.move(m.id, m.column);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Azure Boards: ${(e as Error).message}`);
    }
  }

  private async move(id: number, column: string) {
    const w = this.items.find(i => i.id === id);
    const state = w && this.board && targetState(this.board, column, w.fields['System.WorkItemType']);
    if (!w || !this.board || !state) return this.post({ type: 'revert' });
    try {
      // Setting the state too keeps the item consistent even where the column field alone wouldn't move it.
      await update(w, { [this.board.fields.columnField.referenceName]: column, 'System.State': state });
      await this.model.refresh();
    } catch (e) {
      this.post({ type: 'revert' });
      vscode.window.showErrorMessage(t('Could not move #{0} to {1}: {2}', id, column, (e as Error).message));
    }
  }
}

const CSS = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 12px;margin:0}
body.busy{cursor:progress}body.busy .board{opacity:.6}
.bar{display:flex;align-items:center;gap:8px;padding:10px 0;position:sticky;top:0;background:var(--vscode-editor-background);z-index:1}
.bar h1{font-size:1.15em;margin:0 8px 0 0;font-weight:600}
.summary{opacity:.7;margin-left:4px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 10px;border-radius:2px;cursor:pointer;font:inherit}
button:hover{background:var(--vscode-button-hoverBackground)}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:3px;font:inherit}
.board{display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:12px}
.column{flex:0 0 260px;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:4px;display:flex;flex-direction:column;max-height:calc(100vh - 70px)}
.column.drop{outline:2px dashed var(--vscode-focusBorder);outline-offset:-2px}
.column header{display:flex;justify-content:space-between;padding:8px 10px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}
.count{opacity:.7;font-weight:normal}.count.over{color:var(--vscode-errorForeground);opacity:1;font-weight:600}
.cards{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:40px}
.empty{opacity:.5;text-align:center;padding:8px}
.card{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-left:4px solid;border-radius:3px;padding:6px 8px;cursor:grab}
.card:hover{border-color:var(--vscode-focusBorder)}
.card:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.card.dragging{opacity:.4}
.card.active{box-shadow:0 0 0 2px var(--vscode-charts-green)}
.head{display:flex;gap:6px;align-items:center;font-size:.9em;opacity:.8}
.head .who{margin-left:auto;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:50%;min-width:20px;height:20px;line-height:20px;text-align:center;font-size:.8em}
.title{margin:4px 0;overflow-wrap:anywhere}
.tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:8px;padding:0 6px;font-size:.8em}
.message{opacity:.8;padding:20px 0}
@media (prefers-reduced-motion:no-preference){.card{transition:border-color .1s}}
`;
