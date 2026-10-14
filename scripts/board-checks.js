// Interaction checks for the Kanban webview, run by .harness/index.html?test against the sample data in board-harness.mjs.
// Results go to the page, the console and the title ("PASS 33/33"), so a browser or an automation tool can read them.
(async () => {
  const results = [];
  const ok = (name, cond, info) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || info === undefined ? '' : ` — ${JSON.stringify(info)}`}`);
  const $$ = s => [...document.querySelectorAll(s)];
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const key = (el, k, altKey = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey, bubbles: true }));
  const card = id => document.querySelector(`.card[data-id="${id}"]`);
  const where = id => card(id)?.closest('section')?.getAttribute('aria-label');
  const heads = () => Object.fromEntries($$('.colhead').map(h => [h.querySelector('.name').textContent, h.querySelector('.count').textContent]));
  const total = cell => cell.querySelectorAll('.card').length + Number(cell.querySelector('.more')?.textContent.match(/\((\d+)\)/)[1] ?? 0);
  const cellsOf = column => $$('section.cell').filter(s => s.getAttribute('aria-label').split(' · ')[0] === column);
  const btn = text => $$('.presets button').find(b => b.textContent === text);
  const laned = DATA.lanes.length > 1;
  while (!document.querySelector('.board')) await wait(20);

  for (const [name, count] of Object.entries(heads())) {
    const n = cellsOf(name).reduce((a, c) => a + total(c), 0);
    ok(`column ${name}: header counts its cards`, String(n) === count.split('/')[0], { header: count, cells: n });
  }
  ok('WIP limit exceeded is flagged', document.querySelector('.count.over')?.textContent.endsWith('/3'));
  for (const b of $$('.lane')) {
    const [, name, n] = b.textContent.match(/^. (.*) \((\d+)\)$/);
    const sum = $$('section.cell').filter(s => s.getAttribute('aria-label').endsWith(` · ${name}`)).reduce((a, c) => a + total(c), 0);
    ok(`lane ${name}: title counts its cards`, sum === Number(n), { title: n, cells: sum });
  }
  ok(laned ? 'New and Done span the lanes' : 'no lanes: nothing spans', $$('.cell.span').length === (laned ? 2 : 0));
  ok('DOM order follows the columns', $$('section.cell')[0].getAttribute('aria-label') === 'New' && $$('section.cell').at(-1).getAttribute('aria-label') === 'Done');
  const who = card(101).querySelector('.who');
  ok('initials drawn by CSS, full name in the card name', getComputedStyle(who, '::before').content === '"AC"' && who.textContent === '' && card(101).getAttribute('aria-label').endsWith('Alex Contoso'));

  const shown = cellsOf('New')[0].querySelectorAll('.card').length;
  cellsOf('New')[0].querySelector('.more').click(); await wait(20);
  ok('show more adds 4 and focuses the first new card', cellsOf('New')[0].querySelectorAll('.card').length === shown + 4 && cellsOf('New')[0].querySelectorAll('.card')[shown] === document.activeElement);

  key(document.body, '/'); await wait(20);
  ok('/ focuses search', document.activeElement?.id === 'search');
  const search = document.getElementById('search');
  search.value = 'fiber'; search.dispatchEvent(new Event('input')); await wait(20);
  const found = $$('.card');
  ok('search filters and keeps focus', found.length > 0 && found.every(c => c.getAttribute('aria-label').toLowerCase().includes('fiber')) && document.activeElement?.id === 'search');
  key(document.getElementById('search'), 'Escape'); await wait(20);
  ok('Escape clears search', document.getElementById('search').value === '' && $$('.card').length > found.length);

  btn('Mine').click(); await wait(20);
  ok('Mine', $$('.card').length > 0 && $$('.card').every(c => c.getAttribute('aria-label').endsWith('Alex Contoso')) && btn('Mine').getAttribute('aria-pressed') === 'true');
  btn('Mine').click(); await wait(20); btn('Unassigned').click(); await wait(20);
  ok('Unassigned', $$('.card').length > 0 && $$('.card').every(c => c.getAttribute('aria-label').endsWith('Unassigned')));
  btn('Unassigned').click(); await wait(20); btn('Hide done').click(); await wait(20);
  ok('Hide done', !heads().Done);
  btn('Hide done').click(); await wait(20);
  ok('presets are saved', sent.filter(m => m.type === 'saveView').length === 8);
  btn('Current sprint').click();
  ok('Current sprint asks the extension', sent.at(-1).type === 'toggleSprint');

  if (laned) {
    $$('.lane')[1].click(); await wait(20);
    ok('collapsing a lane hides its cells and is saved', !$$('section.cell').some(c => c.getAttribute('aria-label').endsWith(' · Expedite'))
      && $$('.lane')[1].getAttribute('aria-expanded') === 'false' && JSON.stringify(sent.at(-1).view?.collapsed) === '["Expedite"]');
    ok('New still spans to the last row', getComputedStyle(cellsOf('New')[0]).gridRowEnd === '7');
    $$('.lane')[1].click(); await wait(20);
  }

  // Every cell fully expanded, so the cards picked below are on screen.
  while (document.querySelector('.more')) { document.querySelector('.more').click(); await wait(10); }
  const visible = (column, test) => DATA.cards.find(c => test(c) && cellsOf(column).some(cell => cell.contains(card(c.id))));
  const bug = visible('Committed', c => c.type === 'Bug');
  card(bug.id).focus(); key(card(bug.id), 'ArrowRight', true); await wait(100);
  ok('Alt+→ skips a column that rejects the type', where(bug.id) === 'Done' && document.activeElement === card(bug.id), where(bug.id));
  ok('move is sent with the lane kept', JSON.stringify(sent.at(-1)) === JSON.stringify({ type: 'move', id: bug.id, column: 'Done', lane: bug.lane }));
  ok('move is announced', document.getElementById('live').textContent === 'Moved to Done', document.getElementById('live').textContent);
  const pbi = visible('Approved', c => c.type !== 'Bug' && c.lane === '');
  const pbiCell = laned ? 'Approved · Default lane' : 'Approved';
  card(pbi.id).focus(); key(card(pbi.id), 'ArrowUp', true); await wait(20);
  ok('Alt+↑ in the top lane does nothing', where(pbi.id) === pbiCell);
  if (laned) {
    key(card(pbi.id), 'ArrowDown', true); await wait(100);
    ok('Alt+↓ moves to the next lane and says so', where(pbi.id) === 'Approved · Expedite' && document.getElementById('live').textContent === 'Moved to Approved · Expedite');
  }
  const fresh = visible('New', () => true);
  const before = sent.length;
  card(fresh.id).focus(); key(card(fresh.id), 'ArrowDown', true); key(card(fresh.id), 'ArrowLeft', true); await wait(20);
  ok('Alt+↓/← in New do nothing', sent.length === before && where(fresh.id) === 'New');
  key(card(fresh.id), 'Enter');
  ok('Enter opens', JSON.stringify(sent.at(-1)) === JSON.stringify({ type: 'open', id: fresh.id }));

  postMessage({ type: 'revert' }, '*'); await wait(20);
  ok('revert restores the last data', where(bug.id) === (laned ? `Committed · ${bug.lane || 'Default lane'}` : 'Committed') && where(pbi.id) === pbiCell);
  const select = document.querySelector('.bar select');
  select.value = '2'; select.dispatchEvent(new Event('change'));
  ok('board picker', JSON.stringify(sent.at(-1)) === '{"type":"selectBoard","id":"2"}');
  document.querySelector('.tools > button:not(.icon)').click();
  ok('Filter…', sent.at(-1).type === 'filter');
  document.querySelector('button.icon').click();
  ok('Refresh', sent.at(-1).type === 'refresh');
  postMessage({ type: 'message', text: 'Pick a project' }, '*'); await wait(20);
  ok('a message replaces the board', document.querySelector('.message')?.textContent === 'Pick a project' && !document.querySelector('.board'));

  const passed = results.filter(r => r.startsWith('PASS')).length;
  document.title = `${passed === results.length ? 'PASS' : 'FAIL'} ${passed}/${results.length}`;
  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = [document.title, ...results].join('\n');
  document.body.append(pre);
  console.log(pre.textContent);
})();
