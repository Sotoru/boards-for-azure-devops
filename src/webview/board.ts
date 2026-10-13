// Runs inside the Kanban webview. All Azure DevOps data is inserted with textContent, never as HTML.
import type { BoardData, BoardView, CardData, FromWebview, ToWebview } from '../boardMessages';

declare function acquireVsCodeApi(): { postMessage(m: FromWebview): void };
const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
let data: BoardData | undefined;
// Presets and search filter what's already loaded, so they apply instantly; "current sprint" is the shared filter and reloads.
// The extension saves them and sends them back with the first data, so they survive closing the board and reloading the window.
let presets: BoardView = { who: 'all', hideDone: false, collapsed: [], query: '' };
const save = () => vscode.postMessage({ type: 'saveView', view: presets });

// Cards per cell before "show more"; each click shows PAGE more. Kept per column+lane across reloads of the data.
const PAGE = 4;
const expanded = new Map<string, number>();

// Free-text search over what's loaded: every word must match the id, title, type, assignee or a tag.
const matches = (c: CardData) => presets.query.toLowerCase().split(/\s+/).filter(Boolean).every(w =>
  `#${c.id} ${c.title} ${c.type} ${c.assignee ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(w));
const shown = (c: CardData) => matches(c) && (presets.who === 'all' || (presets.who === 'mine' ? c.mine : !c.assignee));
const shownColumns = () => data!.columns.filter(c => !(presets.hideDone && c.done));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const accepts = (column: string, card: CardData) => !!data?.columns.find(c => c.name === column)?.accepts.includes(card.type);

/** Optimistic move; the extension sends 'revert' if Azure DevOps rejects it. */
function move(card: CardData, column: string, lane = card.lane) {
  if (!data || (card.column === column && card.lane === lane) || !accepts(column, card)) return;
  card.column = column;
  card.lane = lane;
  render(card.id);
  vscode.postMessage({ type: 'move', id: card.id, column, lane });
}

function cardEl(card: CardData) {
  const c = el('div', `card${card.active ? ' active' : ''}`);
  c.draggable = true;
  c.tabIndex = 0;
  c.dataset.id = String(card.id);
  c.style.borderLeftColor = card.color || 'var(--vscode-focusBorder)';
  c.setAttribute('role', 'button');
  c.setAttribute('aria-label', `#${card.id} ${card.title}, ${card.type}, ${card.assignee ?? data!.labels.unassigned}`);
  c.setAttribute('aria-description', data!.labels.moveHint);
  c.title = data!.labels.moveHint;

  const head = el('div', 'head');
  head.append(el('span', 'id', `#${card.id}`), el('span', 'type', card.type));
  const who = el('span', 'who', card.initials || '—');
  who.title = card.assignee ?? data!.labels.unassigned;
  head.append(who);
  c.append(head, el('div', 'title', card.title));
  if (card.tags.length) {
    const tags = el('div', 'tags');
    for (const t of card.tags) tags.append(el('span', 'tag', t));
    c.append(tags);
  }

  c.addEventListener('click', () => vscode.postMessage({ type: 'open', id: card.id }));
  c.addEventListener('dragstart', e => { e.dataTransfer!.setData('text/plain', String(card.id)); c.classList.add('dragging'); });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  // Keyboard alternative to drag & drop: Alt+←/→ moves to the previous/next column that accepts the card, Alt+↑/↓ to the adjacent lane.
  c.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vscode.postMessage({ type: 'open', id: card.id }); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const lane = data!.lanes[data!.lanes.indexOf(card.lane) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (lane !== undefined) move(card, card.column, lane);
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const cols = shownColumns().map(x => x.name);
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      for (let i = cols.indexOf(card.column) + step; i >= 0 && i < cols.length; i += step) {
        if (accepts(cols[i], card)) { move(card, cols[i]); break; }
      }
    }
  });
  return c;
}

/** Circular arrow drawn with currentColor, so it follows the theme like a codicon. */
function refreshIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M13 8a5 5 0 1 1-1.5-3.6', 'M12 1.5v3.2H8.8']) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function render(focusId?: number) {
  if (!data) return;
  // The whole page is rebuilt: keep typing in the search box across renders.
  const typing = document.activeElement?.id === 'search' ? (document.activeElement as HTMLInputElement).selectionStart : null;
  root.replaceChildren();

  const bar = el('div', 'bar');
  bar.append(el('h1', undefined, data.title));
  if (data.boards.length > 1) {
    const select = el('select');
    select.setAttribute('aria-label', data.labels.board);
    for (const b of data.boards) {
      const o = el('option', undefined, b.name);
      o.value = b.id;
      o.selected = b.id === data.board;
      select.append(o);
    }
    select.addEventListener('change', () => vscode.postMessage({ type: 'selectBoard', id: select.value }));
    bar.append(select);
  }
  const filter = el('button', undefined, data.labels.filter);
  filter.addEventListener('click', () => vscode.postMessage({ type: 'filter' }));
  const refresh = el('button', 'icon');
  refresh.title = data.labels.refresh;
  refresh.setAttribute('aria-label', data.labels.refresh);
  refresh.append(refreshIcon());
  refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  const toggle = (label: string, on: boolean, click: () => void) => {
    const b = el('button', 'secondary', label);
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', click);
    return b;
  };
  const set = (p: Partial<BoardView>) => { Object.assign(presets, p); save(); render(); };
  const group = el('div', 'presets');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', data.labels.presets);
  group.append(
    toggle(data.labels.mine, presets.who === 'mine', () => set({ who: presets.who === 'mine' ? 'all' : 'mine' })),
    toggle(data.labels.unassigned, presets.who === 'unassigned', () => set({ who: presets.who === 'unassigned' ? 'all' : 'unassigned' })),
    toggle(data.labels.sprint, data.currentSprint, () => vscode.postMessage({ type: 'toggleSprint' })),
    toggle(data.labels.hideDone, presets.hideDone, () => set({ hideDone: !presets.hideDone })),
  );
  // Title, board and count on the left; presets and filters pushed to the right.
  const tools = el('div', 'tools');
  const search = el('input');
  search.id = 'search';
  search.type = 'search';
  search.value = presets.query;
  search.placeholder = data.labels.search;
  search.setAttribute('aria-label', data.labels.search);
  search.addEventListener('input', () => set({ query: search.value }));
  search.addEventListener('keydown', e => { if (e.key === 'Escape' && presets.query) { e.preventDefault(); set({ query: '' }); } });
  tools.append(search, group, filter, refresh);
  bar.append(el('span', 'summary', data.summary), tools);
  root.append(bar);

  // Grid: a header per column, then for each lane a title row (only with more than one lane) and one drop cell per column.
  const columns = shownColumns();
  const visible = data.cards.filter(shown);
  const board = el('div', 'board');
  board.style.setProperty('--cols', String(columns.length));
  for (const col of columns) {
    const n = visible.filter(c => c.column === col.name).length;
    const head = el('header', 'colhead');
    head.append(el('span', 'name', col.name));
    head.append(el('span', `count${col.limit && n > col.limit ? ' over' : ''}`, col.limit ? `${n}/${col.limit}` : String(n)));
    board.append(head);
  }
  const laned = data.lanes.length > 1;
  board.classList.toggle('laned', laned);
  for (const lane of data.lanes) {
    const laneName = lane || data.labels.defaultLane;
    const closed = laned && presets.collapsed.includes(lane);
    if (laned) {
      const head = el('button', 'lane', `${closed ? '▸' : '▾'} ${laneName} (${visible.filter(c => c.lane === lane && columns.some(x => x.name === c.column)).length})`);
      head.setAttribute('aria-expanded', String(!closed));
      head.addEventListener('click', () => {
        set({ collapsed: closed ? presets.collapsed.filter(l => l !== lane) : [...presets.collapsed, lane] });
      });
      board.append(head);
    }
    if (closed) continue;
    for (const col of columns) {
      const cards = visible.filter(c => c.column === col.name && c.lane === lane);
      const cell = el('section', 'cell');
      cell.setAttribute('aria-label', laned ? `${col.name} · ${laneName}` : col.name);
      const key = `${col.name}\n${lane}`;
      // A card just moved here stays visible even if it lands past the limit.
      const focused = cards.findIndex(c => c.id === focusId);
      if (focused >= 0) expanded.set(key, Math.max(expanded.get(key) ?? PAGE, focused + 1));
      const limit = expanded.get(key) ?? PAGE;
      for (const card of cards.slice(0, limit)) cell.append(cardEl(card));
      if (!cards.length) cell.append(el('div', 'empty', data.labels.empty));
      if (cards.length > limit) {
        const more = el('button', 'more', `▾ ${data.labels.showMore} (${cards.length - limit})`);
        more.addEventListener('click', () => { expanded.set(key, limit + PAGE); render(); root.querySelector<HTMLElement>(`.card[data-id="${cards[limit].id}"]`)?.focus(); });
        cell.append(more);
      }

      cell.addEventListener('dragover', e => {
        const id = Number(document.querySelector<HTMLElement>('.card.dragging')?.dataset.id);
        const card = data!.cards.find(c => c.id === id);
        if (card && accepts(col.name, card)) { e.preventDefault(); cell.classList.add('drop'); }
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('drop');
        const card = data!.cards.find(c => c.id === Number(e.dataTransfer!.getData('text/plain')));
        if (card) move(card, col.name, lane);
      });
      board.append(cell);
    }
  }
  root.append(board);
  if (typing !== null) { search.focus(); search.setSelectionRange(typing, typing); }
  if (focusId !== undefined) root.querySelector<HTMLElement>(`.card[data-id="${focusId}"]`)?.focus();
}

addEventListener('keydown', e => {
  if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
    e.preventDefault();
    document.getElementById('search')?.focus();
  }
});

let snapshot = '';
window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m.type === 'data') { if (!data) presets = { ...presets, ...m.data.view }; data = m.data; snapshot = JSON.stringify(m.data); render(); }
  if (m.type === 'revert' && snapshot) { data = JSON.parse(snapshot); render(); }
  if (m.type === 'busy') document.body.classList.toggle('busy', m.on);
  if (m.type === 'message') { root.replaceChildren(el('p', 'message', m.text)); }
});
vscode.postMessage({ type: 'ready' });
