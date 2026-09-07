import test from 'node:test';
import assert from 'node:assert/strict';
import { stripStylesheetCrossorigin } from './strip-stylesheet-crossorigin.mjs';

test('drops crossorigin from the emitted stylesheet link', () => {
  const out = stripStylesheetCrossorigin(
    '<link rel="stylesheet" crossorigin href="/assets/index-C6vUCxTS.css">'
  );
  assert.equal(out, '<link rel="stylesheet" href="/assets/index-C6vUCxTS.css">');
});

test('drops it whichever side of rel it lands on', () => {
  const out = stripStylesheetCrossorigin('<link crossorigin rel="stylesheet" href="/a.css">');
  assert.equal(out, '<link rel="stylesheet" href="/a.css">');
});

test('leaves the module script alone', () => {
  // A module script is fetched in CORS mode regardless of the attribute, so
  // removing it there would change nothing and only obscure that fact.
  const tag = '<script type="module" crossorigin src="/assets/index.js"></script>';
  assert.equal(stripStylesheetCrossorigin(tag), tag);
});

test('leaves other links alone', () => {
  const tag = '<link rel="preconnect" crossorigin href="https://fonts.gstatic.com">';
  assert.equal(stripStylesheetCrossorigin(tag), tag);
});

test('leaves a stylesheet that never had one alone', () => {
  const tag = '<link rel="stylesheet" href="/a.css">';
  assert.equal(stripStylesheetCrossorigin(tag), tag);
});

test('handles the whole document Vite emits', () => {
  const html = [
    '<!doctype html><html><head>',
    '<script type="module" crossorigin src="/assets/index-CuZSF4cn.js"></script>',
    '<link rel="stylesheet" crossorigin href="/assets/index-C6vUCxTS.css">',
    '</head><body></body></html>',
  ].join('\n');
  const out = stripStylesheetCrossorigin(html);
  assert.match(out, /<script type="module" crossorigin/);
  assert.doesNotMatch(out, /<link[^>]*crossorigin/);
});
