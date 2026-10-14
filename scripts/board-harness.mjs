// Builds .harness/index.html: the Kanban webview with the real CSS and bundle, fake data and VS Code theme colors.
// `npm run harness`, then open it in a browser: ?theme=dark|light|hc|hclight, ?lanes=none, ?test runs scripts/board-checks.js.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync('src/board.ts', 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
mkdirSync('.harness', { recursive: true });
copyFileSync('dist/board.js', '.harness/board.js');
copyFileSync('scripts/board-checks.js', '.harness/board-checks.js');

// Hand-written sample data (contoso/fabrikam only): a Bug that Testing rejects, a WIP limit exceeded, long titles, tags.
const columns = ['New', 'Approved', 'Committed', 'Testing', 'Done'];
const lanes = ['', 'Expedite', 'Fabrikam Fiber'];
const people = [undefined, 'Alex Contoso', 'Sam Fabrikam', 'Robin Contoso'];
const cards = Array.from({ length: 60 }, (_, i) => {
  const type = i % 7 ? 'Product Backlog Item' : 'Bug';
  let column = i < 27 ? 'New' : columns[(i * 7) % 5];
  if (type === 'Bug' && column === 'Testing') column = 'Committed';
  const assignee = people[i % 4];
  return {
    id: 100 + i, type, column, lane: lanes[(i * 5) % 3], assignee, mine: assignee === 'Alex Contoso',
    title: `Sample item ${i} for Fabrikam${i % 9 ? '' : ' with a much longer title that wraps over several lines'}`,
    color: type === 'Bug' ? '#cc293d' : '#009ccc', initials: assignee ? assignee.split(' ').map(p => p[0]).join('') : '',
    tags: ['web', 'fiber'].slice(0, i % 3), active: i === 30,
  };
});
const data = {
  title: 'Fabrikam Team · Backlog items', summary: '60', board: '1',
  boards: [{ id: '1', name: 'Backlog items' }, { id: '2', name: 'Features' }],
  columns: columns.map(name => ({
    name, limit: name === 'Approved' ? 3 : 0, done: name === 'Done', split: name !== 'New' && name !== 'Done',
    accepts: name === 'Testing' ? ['Product Backlog Item'] : ['Product Backlog Item', 'Bug'],
  })),
  currentSprint: false, view: {}, lanes, cards,
  labels: {
    filter: 'Filter…', refresh: 'Refresh', empty: 'No items', unassigned: 'Unassigned', board: 'Board', defaultLane: 'Default lane',
    search: 'Search (/)', mine: 'Mine', sprint: 'Current sprint', showMore: 'Show more', hideDone: 'Hide done', presets: 'Presets',
    moved: 'Moved to {0}', moveHint: 'Drag to another column or lane, or Alt+arrows. Enter opens.',
  },
};

// The colors that matter here, copied from VS Code's Dark Modern, Light Modern and the two high contrast themes.
const themes = {
  dark: { 'editor-background': '#1f1f1f', 'sideBar-background': '#181818', foreground: '#cccccc', 'panel-border': '#2b2b2b', descriptionForeground: '#9d9d9d', 'button-background': '#0078d4', 'button-foreground': '#ffffff', 'button-hoverBackground': '#026ec1', 'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc', focusBorder: '#0078d4', 'textLink-foreground': '#4daafc', 'badge-background': '#616161', 'badge-foreground': '#f8f8f8', 'input-background': '#313131', 'input-foreground': '#cccccc', 'input-border': '#3c3c3c', 'input-placeholderForeground': '#989898', errorForeground: '#f85149', 'list-errorForeground': '#f88070', 'list-hoverBackground': '#2a2d2e', 'dropdown-background': '#313131', 'dropdown-foreground': '#cccccc', 'dropdown-border': '#3c3c3c', 'icon-foreground': '#cccccc', 'toolbar-hoverBackground': '#5a5d5e50' },
  light: { 'editor-background': '#ffffff', 'sideBar-background': '#f8f8f8', foreground: '#3b3b3b', 'panel-border': '#e5e5e5', descriptionForeground: '#3b3b3b', 'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0258a8', 'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b', focusBorder: '#005fb8', 'textLink-foreground': '#005fb8', 'badge-background': '#cccccc', 'badge-foreground': '#3b3b3b', 'input-background': '#ffffff', 'input-foreground': '#3b3b3b', 'input-border': '#cecece', 'input-placeholderForeground': '#767676', errorForeground: '#f85149', 'list-errorForeground': '#b01011', 'list-hoverBackground': '#f2f2f2', 'dropdown-background': '#ffffff', 'dropdown-foreground': '#3b3b3b', 'dropdown-border': '#cecece', 'icon-foreground': '#3b3b3b', 'toolbar-hoverBackground': '#b8b8b850' },
  hc: { 'editor-background': '#000000', 'sideBar-background': '#000000', foreground: '#ffffff', 'panel-border': '#6fc3df', contrastBorder: '#6fc3df', descriptionForeground: '#ffffff', 'button-background': '#000000', 'button-foreground': '#ffffff', 'button-border': '#6fc3df', 'button-secondaryBackground': '#000000', 'button-secondaryForeground': '#ffffff', focusBorder: '#f38518', 'textLink-foreground': '#21a6ff', 'badge-background': '#000000', 'badge-foreground': '#ffffff', 'input-background': '#000000', 'input-foreground': '#ffffff', 'input-border': '#6fc3df', 'input-placeholderForeground': '#ffffffb3', errorForeground: '#f48771', 'list-errorForeground': '#f48771', 'dropdown-background': '#000000', 'dropdown-foreground': '#ffffff', 'dropdown-border': '#6fc3df', 'icon-foreground': '#ffffff' },
  hclight: { 'editor-background': '#ffffff', 'sideBar-background': '#ffffff', foreground: '#292929', 'panel-border': '#0f4a85', contrastBorder: '#0f4a85', descriptionForeground: '#292929', 'button-background': '#0f4a85', 'button-foreground': '#ffffff', 'button-border': '#0f4a85', 'button-secondaryBackground': '#ffffff', 'button-secondaryForeground': '#292929', focusBorder: '#006bbd', 'textLink-foreground': '#0f4a85', 'badge-background': '#0f4a85', 'badge-foreground': '#ffffff', 'input-background': '#ffffff', 'input-foreground': '#292929', 'input-border': '#0f4a85', 'input-placeholderForeground': '#292929b3', errorForeground: '#b5200d', 'list-errorForeground': '#b5200d', 'dropdown-background': '#ffffff', 'dropdown-foreground': '#292929', 'dropdown-border': '#0f4a85', 'icon-foreground': '#292929' },
};
const themeCss = Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, Object.entries(v).map(([n, c]) => `--vscode-${n}:${c}`).join(';')]));

writeFileSync('.harness/index.html', `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Board</title>
<style id="theme"></style><style>html{--vscode-font-family:-apple-system,'Segoe UI',sans-serif;--vscode-font-size:13px}body{background:var(--vscode-editor-background)}${css}</style></head>
<body><main id="root"></main><div id="live" class="sr" role="status"></div><script>
const q = new URLSearchParams(location.search);
document.getElementById('theme').textContent = 'html{' + ${JSON.stringify(themeCss)}[q.get('theme') || 'dark'] + '}';
window.DATA = ${JSON.stringify(data)};
if (q.get('lanes') === 'none') { DATA.lanes = ['']; DATA.cards.forEach(c => c.lane = ''); }
// Stands in for the extension: records every message and answers 'ready' with the data.
window.sent = [];
window.acquireVsCodeApi = () => ({ postMessage(m) { sent.push(m); if (m.type === 'ready') setTimeout(() => postMessage({ type: 'data', data: DATA }, '*')); } });
</script><script src="board.js"></script><script>if (q.has('test')) document.write('<script src="board-checks.js"><\\/script>');</script></body></html>
`);
console.log('.harness/index.html (?theme=dark|light|hc|hclight, ?lanes=none, ?test)');
