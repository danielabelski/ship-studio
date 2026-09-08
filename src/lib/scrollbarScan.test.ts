import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScrollbarScanner, rootsFromMutations, OS_ATTR } from './scrollbarScan';

const SKIP = '[class*="-modal"], .workspace-sidebar-scroll';
const ASSETS = '.assets-list-container';

/**
 * jsdom computes no real overflow, so styles are supplied per element by a
 * lookup the tests control. The counter is the point of the whole module: it
 * is how many times style was resolved, which in the browser is a forced style
 * recalculation on the main thread.
 */
function scanner(styles: Map<Element, Partial<CSSStyleDeclaration>> = new Map()) {
  const attach = vi.fn();
  let styleReads = 0;
  const s = createScrollbarScanner({
    attach,
    skipSelector: SKIP,
    assetSelector: ASSETS,
    computeStyle: (el) => {
      styleReads += 1;
      return {
        overflowY: 'visible',
        scrollbarWidth: 'auto',
        ...(styles.get(el) ?? {}),
      } as CSSStyleDeclaration;
    },
  });
  return { scanner: s, attach, styleReads: () => styleReads, styles };
}

function html(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createScrollbarScanner', () => {
  it('attaches to a scrollable element and marks it', () => {
    const root = html('<div id="a"></div>');
    const el = document.getElementById('a')!;
    const s = scanner(new Map([[el, { overflowY: 'auto' }]]));

    s.scanner.scan(root);

    expect(s.attach).toHaveBeenCalledWith(el, false);
    expect(el.hasAttribute(OS_ATTR)).toBe(true);
  });

  it('leaves a non-scrolling element alone', () => {
    const root = html('<div id="a"></div>');
    const s = scanner();
    s.scanner.scan(root);
    expect(s.attach).not.toHaveBeenCalled();
  });

  it('respects an element that hides its scrollbar deliberately', () => {
    const root = html('<div id="a"></div>');
    const el = document.getElementById('a')!;
    const s = scanner(new Map([[el, { overflowY: 'scroll', scrollbarWidth: 'none' }]]));
    s.scanner.scan(root);
    expect(s.attach).not.toHaveBeenCalled();
  });

  it('skips containers that opt out, and lets the assets list opt back in', () => {
    const root = html(`
      <div class="thing-modal"><div id="inside"></div></div>
      <div class="thing-modal"><div id="assets" class="assets-list-container"></div></div>
    `);
    const inside = document.getElementById('inside')!;
    const assets = document.getElementById('assets')!;
    const s = scanner(
      new Map([
        [inside, { overflowY: 'auto' }],
        [assets, { overflowY: 'auto' }],
      ])
    );

    s.scanner.scan(root);

    expect(s.attach).toHaveBeenCalledTimes(1);
    expect(s.attach).toHaveBeenCalledWith(assets, true);
  });

  /**
   * The one that matters: OverlayScrollbars builds a viewport with
   * `overflow: scroll` inside its host. Attaching to that viewport builds
   * another inside it, and so on — 100% CPU and memory climbing until the
   * window dies.
   */
  it('never looks inside anything OverlayScrollbars owns', () => {
    const root = html(`
      <div data-overlayscrollbars>
        <div id="viewport" data-overlayscrollbars-viewport>
          <div id="content"></div>
        </div>
      </div>
    `);
    const viewport = document.getElementById('viewport')!;
    const content = document.getElementById('content')!;
    const s = scanner(
      new Map([
        [viewport, { overflowY: 'scroll' }],
        [content, { overflowY: 'auto' }],
      ])
    );

    s.scanner.scan(root);

    expect(s.attach).not.toHaveBeenCalled();
  });

  it('never re-attaches to a host it already owns', () => {
    const root = html('<div id="a"></div>');
    const el = document.getElementById('a')!;
    const s = scanner(new Map([[el, { overflowY: 'auto' }]]));

    s.scanner.scan(root);
    s.scanner.invalidate(root);
    s.scanner.scan(root);

    expect(s.attach).toHaveBeenCalledTimes(1);
  });

  /**
   * The reason this module exists. The old implementation walked the whole
   * document on every mutation batch and called `getComputedStyle` on every
   * element that wasn't already a host — so a terminal streaming output kept
   * the app re-deciding the same thousands of elements four times a second,
   * forever, and reaching the same answer every time.
   */
  it('resolves style once per element, however many times it is scanned', () => {
    const root = html('<div><span></span><span></span><p><b></b></p></div>');
    const s = scanner();

    s.scanner.scan(root);
    const afterFirst = s.styleReads();
    expect(afterFirst).toBeGreaterThan(0);

    for (let i = 0; i < 50; i++) s.scanner.scan(root);

    expect(s.styleReads()).toBe(afterFirst);
  });

  it('examines a newly added subtree without re-examining the rest', () => {
    const root = html('<div id="app"><span></span><span></span></div>');
    const s = scanner();
    s.scanner.scan(root);
    const beforeAdd = s.styleReads();

    const added = document.createElement('div');
    added.innerHTML = '<i></i>';
    document.getElementById('app')!.appendChild(added);
    s.scanner.scan(added);

    // The added element and its one child — nothing else.
    expect(s.styleReads() - beforeAdd).toBe(2);
  });

  /**
   * The correctness question the optimisation turns on: an element that was
   * not scrollable can become scrollable when a class changes, on it or on an
   * ancestor. Invalidating the changed subtree is what keeps that working.
   */
  it('re-decides a subtree after a class change turns a descendant scrollable', () => {
    const root = html('<div id="host"><div id="child"></div></div>');
    const host = document.getElementById('host')!;
    const child = document.getElementById('child')!;
    const styles = new Map<Element, Partial<CSSStyleDeclaration>>();
    const s = scanner(styles);

    s.scanner.scan(root);
    expect(s.attach).not.toHaveBeenCalled();

    // A class on the parent cascades into the child's overflow.
    host.classList.add('scrolly');
    styles.set(child, { overflowY: 'auto' });

    s.scanner.invalidate(host);
    s.scanner.scan(host);

    expect(s.attach).toHaveBeenCalledWith(child, false);
  });

  it('counts every element it examined exactly once', () => {
    const root = html('<div><span></span><span></span></div>');
    const s = scanner();
    s.scanner.scan(root);
    const first = s.scanner.examinedCount;
    s.scanner.scan(root);
    expect(s.scanner.examinedCount).toBe(first);
  });
});

describe('rootsFromMutations', () => {
  const record = (partial: Partial<MutationRecord>): MutationRecord =>
    ({
      type: 'childList',
      addedNodes: [] as unknown as NodeList,
      target: document.body,
      ...partial,
    }) as MutationRecord;

  it('collects added elements as roots to scan', () => {
    const a = document.createElement('div');
    const b = document.createElement('span');
    const { added, changed } = rootsFromMutations([
      record({ type: 'childList', addedNodes: [a, b] as unknown as NodeList }),
    ]);
    expect(added).toEqual([a, b]);
    expect(changed).toEqual([]);
  });

  it('collects attribute targets as roots to re-decide', () => {
    const a = document.createElement('div');
    const { added, changed } = rootsFromMutations([record({ type: 'attributes', target: a })]);
    expect(added).toEqual([]);
    expect(changed).toEqual([a]);
  });

  it('ignores text nodes, which have no style of their own', () => {
    const text = document.createTextNode('hi');
    const { added } = rootsFromMutations([
      record({ type: 'childList', addedNodes: [text] as unknown as NodeList }),
    ]);
    expect(added).toEqual([]);
  });

  it('deduplicates a node touched by several records in one batch', () => {
    const a = document.createElement('div');
    const { added } = rootsFromMutations([
      record({ type: 'childList', addedNodes: [a] as unknown as NodeList }),
      record({ type: 'childList', addedNodes: [a] as unknown as NodeList }),
    ]);
    expect(added).toEqual([a]);
  });
});
