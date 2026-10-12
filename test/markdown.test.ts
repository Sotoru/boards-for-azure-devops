import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, isComplexHtml, normalizeTags } from '../src/markdown.ts';

test('htmlToMarkdown converts the simple HTML Azure DevOps produces', () => {
  assert.equal(htmlToMarkdown('<div>Hello <b>world</b> &amp; <i>you</i></div><div>Second<br>line</div>'),
    'Hello **world** & *you*\n\nSecond\nline');
  assert.equal(htmlToMarkdown('<p>See <a href="https://contoso.com/x">docs</a></p>'), 'See [docs](https://contoso.com/x)');
  assert.equal(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
  assert.equal(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>'), '1. a\n1. b');
  assert.equal(htmlToMarkdown('<h2>Title</h2><p>text with <code>x</code></p>'), '## Title\n\ntext with `x`');
  assert.equal(htmlToMarkdown('<pre>if (a &lt; b)<br>  go()</pre>'), '```\nif (a < b)\n  go()\n```');
  assert.equal(htmlToMarkdown(''), '');
});

test('isComplexHtml flags content a Markdown round-trip would lose', () => {
  assert.ok(isComplexHtml('<p>x</p><table><tr><td>1</td></tr></table>'));
  assert.ok(isComplexHtml('<IMG src="a.png">'));
  assert.ok(!isComplexHtml('<div><b>plain</b></div>'));
});

test('normalizeTags accepts commas and semicolons, dedupes', () => {
  assert.equal(normalizeTags(' ui, backend;ui ; ;api '), 'ui; backend; api');
  assert.equal(normalizeTags(''), '');
});
