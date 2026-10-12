// Pure helpers, no `vscode` import, so they run under `node --test`.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ESC[c]);

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
export const plain = (html: string | undefined) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();

// Tree rows are single-line, so the description is split into two word-wrapped rows.
// ponytail: fixed width guess, the sidebar may clip earlier; tune LINE if it looks off.
export const LINE = 50;
export function descLines(text: string, width = LINE, max = 2): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest && lines.length < max) {
    if (rest.length <= width) { lines.push(rest); rest = ''; break; }
    const space = rest.lastIndexOf(' ', width);
    const cut = space > 0 ? space : width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) lines[lines.length - 1] += '…';
  return lines;
}

// Microsoft-account-backed orgs report an all-zero tenant; those must not be pinned to a tenant.
export const normalizeTenant = (t: string | null | undefined) =>
  t && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(t) ? t : undefined;

export const unique = (xs: string[]) =>
  [...new Map(xs.filter(Boolean).map(x => [x.toLowerCase(), x])).values()].sort((a, b) => a.localeCompare(b));
