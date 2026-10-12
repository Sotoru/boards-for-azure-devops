import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, normalizeTenant, plain, unique } from '../src/text.ts';

test('esc escapes html', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(undefined), '');
});

test('plain strips tags and decodes entities', () => {
  assert.equal(plain('<p>Ciao &amp; <b>mondo</b>&nbsp;!</p>'), 'Ciao & mondo !');
  assert.equal(plain(undefined), '');
});

test('normalizeTenant drops the empty MSA tenant', () => {
  assert.equal(normalizeTenant('00000000-0000-0000-0000-000000000000'), undefined);
  assert.equal(normalizeTenant(null), undefined);
  assert.equal(normalizeTenant('11111111-2222-3333-4444-555555555555'), '11111111-2222-3333-4444-555555555555');
});

test('unique dedupes case-insensitively and sorts', () => {
  assert.deepEqual(unique(['fabrikam', 'Contoso', 'contoso', '']), ['contoso', 'fabrikam']);
});
