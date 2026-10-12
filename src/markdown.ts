// Pure HTML <-> editor-text helpers, no `vscode` import, so they run under `node --test`.

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s: string) => s.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]);

/** Content that a plain Markdown round-trip would destroy. */
export const isComplexHtml = (html: string) => /<(table|img|video|iframe|object|svg)\b/i.test(html);

// ponytail: regex conversion for the simple HTML Azure DevOps produces (paragraphs, lists, emphasis, links, code).
// Anything richer is routed to the browser by isComplexHtml; upgrade path is a real HTML parser (e.g. turndown).
export function htmlToMarkdown(html: string): string {
  // Code blocks are set aside so whitespace normalization doesn't eat their indentation.
  const code: string[] = [];
  let s = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    code.push(decode(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    return `<p>\u0000${code.length - 1}\u0000</p>`;
  });
  s = s.replace(/\r?\n/g, ' ');
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => `\n${inner.replace(/<li[^>]*>/gi, '\n1. ')}\n`);
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => `\n${inner.replace(/<li[^>]*>/gi, '\n- ')}\n`);
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${inner}\n\n`);
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => `[${text}](${href})`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s)
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trimEnd().replace(/^ (?=\S)/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => `\`\`\`\n${code[Number(i)]}\n\`\`\``);
}

/** Accepts "a, b; c" and returns Azure DevOps' "a; b; c". */
export const normalizeTags = (input: string) =>
  [...new Set(input.split(/[;,]/).map(t => t.trim()).filter(Boolean))].join('; ');
