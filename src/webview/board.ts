// Runs inside the Kanban webview. All Azure DevOps data is inserted with textContent, never as HTML.
import type { BoardData, CardData, FromWebview, ToWebview } from '../boardMessages';

declare function acquireVsCodeApi(): { postMessage(m: FromWebview): void };
const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
let data: BoardData | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const accepts = (column: string, card: CardData) => !!data?.columns.find(c => c.name === column)?.accepts.includes(card.type);

/** Optimistic move; the extension sends 'revert' if Azure DevOps rejects it. */
function move(card: CardData, column: string) {
  if (!data || card.column === column || !accepts(column, card)) return;
  card.column = column;
  render(card.id);
  vscode.postMessage({ type: 'move', id: card.id, column });
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
  // Keyboard alternative to drag & drop: Alt+←/→ moves to the previous/next column that accepts the card.
  c.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vscode.postMessage({ type: 'open', id: card.id }); }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const cols = data!.columns.map(x => x.name);
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      for (let i = cols.indexOf(card.column) + step; i >= 0 && i < cols.length; i += step) {
        if (accepts(cols[i], card)) { move(card, cols[i]); break; }
      }
    }
  });
  return c;
}

function render(focusId?: number) {
  if (!data) return;
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
  const refresh = el('button', 'secondary', data.labels.refresh);
  refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  bar.append(filter, refresh, el('span', 'summary', data.summary));
  root.append(bar);

  const board = el('div', 'board');
  for (const col of data.columns) {
    const cards = data.cards.filter(c => c.column === col.name);
    const column = el('section', 'column');
    column.setAttribute('aria-label', col.name);
    const head = el('header');
    head.append(el('span', 'name', col.name));
    const count = el('span', `count${col.limit && cards.length > col.limit ? ' over' : ''}`, col.limit ? `${cards.length}/${col.limit}` : String(cards.length));
    head.append(count);
    const list = el('div', 'cards');
    for (const card of cards) list.append(cardEl(card));
    if (!cards.length) list.append(el('div', 'empty', data.labels.empty));

    column.addEventListener('dragover', e => {
      const id = Number(document.querySelector<HTMLElement>('.card.dragging')?.dataset.id);
      const card = data!.cards.find(c => c.id === id);
      if (card && accepts(col.name, card)) { e.preventDefault(); column.classList.add('drop'); }
    });
    column.addEventListener('dragleave', () => column.classList.remove('drop'));
    column.addEventListener('drop', e => {
      e.preventDefault();
      column.classList.remove('drop');
      const card = data!.cards.find(c => c.id === Number(e.dataTransfer!.getData('text/plain')));
      if (card) move(card, col.name);
    });
    column.append(head, list);
    board.append(column);
  }
  root.append(board);
  if (focusId !== undefined) root.querySelector<HTMLElement>(`.card[data-id="${focusId}"]`)?.focus();
}

let snapshot = '';
window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m.type === 'data') { data = m.data; snapshot = JSON.stringify(m.data); render(); }
  if (m.type === 'revert' && snapshot) { data = JSON.parse(snapshot); render(); }
  if (m.type === 'busy') document.body.classList.toggle('busy', m.on);
  if (m.type === 'message') { root.replaceChildren(el('p', 'message', m.text)); }
});
vscode.postMessage({ type: 'ready' });
