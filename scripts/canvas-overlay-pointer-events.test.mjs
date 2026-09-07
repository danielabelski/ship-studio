import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `.preview-canvas-outline > *` hands clicks back to anything placed in the
 * active frame's overlay. That is right for the edit toolbar and wrong for the
 * comment layer, which is not chrome but a full-bleed `inset: 0` box over the
 * whole frame.
 *
 * Both files set `pointer-events` on it at the same specificity, so the winner
 * came down to bundle order — and preview-canvas.css is emitted later. It
 * resolved to `auto`, the invisible layer swallowed every click meant for the
 * page, and on a breakpoint canvas with comments open no element could be
 * picked and no comment authored. Pins from comments made in single-frame mode
 * still rendered and still opened, so the feature looked alive from outside.
 *
 * This lives here rather than in a Vitest file for two reasons: `import
 * ... ?raw` on a .css file is intercepted by Vite's CSS pipeline and hands the
 * test an empty string, and jsdom parses zero rules out of canvas-comments.css,
 * so a `getComputedStyle` assertion passes without testing anything. The
 * cascade is modelled explicitly instead. It was verified for real by clicking
 * the running app before and after the fix.
 */

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../src/styles/features/${name}`, import.meta.url)), 'utf8');
const canvasCommentsCss = read('canvas-comments.css');
const previewCanvasCss = read('preview-canvas.css');

/** Specificity as ids/classes/elements — enough for the selectors involved. */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/[.:[][\w-]+/g) ?? []).length;
  return ids * 100 + classes * 10;
}

/** Every `pointer-events` declaration in a sheet, in source order. */
function pointerEventsRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^}]*pointer-events\s*:\s*([\w-]+)[^}]*)\}/g)].map((m) => ({
    selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    value: m[3],
  }));
}

const RELEVANT = new Set([
  '.canvas-comment-layer',
  '.preview-canvas-outline > *',
  '.preview-canvas-outline > .canvas-comment-layer',
]);

/**
 * Which declaration wins for a comment layer inside the active frame's outline,
 * given the order the production bundle emits the sheets in (canvas-comments
 * first, preview-canvas second).
 */
function winner() {
  const candidates = [
    ...pointerEventsRules(canvasCommentsCss),
    ...pointerEventsRules(previewCanvasCss),
  ].filter((r) => RELEVANT.has(r.selector));

  assert.ok(candidates.length > 0, 'no pointer-events rules matched — selectors were renamed');
  // Later source order wins a specificity tie, which is exactly how this broke.
  return candidates.reduce((best, r) =>
    specificity(r.selector) >= specificity(best.selector) ? r : best
  );
}

test('the comment layer resolves to click-through inside the active frame outline', () => {
  // If this is 'auto', clicking the page on a breakpoint canvas does nothing.
  assert.equal(winner().value, 'none');
});

test('it wins on specificity, not on which file happens to be bundled last', () => {
  assert.ok(
    specificity(winner().selector) > specificity('.preview-canvas-outline > *'),
    'the exception must outrank the blanket rule regardless of bundle order'
  );
});

test('the blanket rule that hands clicks back to the edit toolbar still exists', () => {
  const blanket = pointerEventsRules(previewCanvasCss).find(
    (r) => r.selector === '.preview-canvas-outline > *'
  );
  assert.equal(blanket?.value, 'auto');
});

test('a pin inside the click-through layer still takes its own clicks', () => {
  const pin = pointerEventsRules(canvasCommentsCss).find(
    (r) => r.selector === '.canvas-comment-pin-marker'
  );
  assert.equal(pin?.value, 'auto');
});

test('the layer being guarded really does cover the whole frame', () => {
  // The blanket rule would be harmless over a small box; the danger is that
  // this one is full-bleed. If the class is ever renamed, this fails rather
  // than the guard above passing silently against nothing.
  assert.match(canvasCommentsCss, /\.canvas-comment-layer\s*\{[^}]*inset:\s*0/);
});
