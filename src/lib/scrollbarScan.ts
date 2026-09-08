/**
 * Deciding which elements OverlayScrollbars should be attached to, and — the
 * part that matters — how often we have to ask.
 *
 * The app attaches OverlayScrollbars to anything that scrolls, wherever it
 * appears, which means watching the DOM for new containers. The obvious
 * implementation walks the whole document whenever anything changes, and that
 * is what this replaces. Its cost is not the walk; it is `getComputedStyle` on
 * every element in the document, which forces style resolution on the main
 * thread. Roughly 3ms over a thousand elements, four times a second, and the
 * app is much larger than a thousand elements.
 *
 * It also never stopped. An element examined and found not to scroll was
 * examined again on the next pass, and the pass after that, forever — and
 * something is always mutating: xterm rebuilds its rows on every frame while an
 * agent streams output, so the sweep ran continuously for the whole of an agent
 * turn, re-deciding the same thousands of elements about a thousand times a
 * minute and reaching the same conclusion every time.
 *
 * So: remember what has been examined, and re-examine only what changed.
 * Correctness turns on one question — can an element that was not scrollable
 * become scrollable without being re-added to the DOM? Yes, if its computed
 * overflow changes, which happens when a class or inline style changes on it or
 * on an ancestor. Those are observable, so they are observed, and an attribute
 * change re-examines that element's whole subtree (the cascade reaches
 * descendants too). Content growth is not a case: `overflow-y` is a style, and
 * a container filling up does not change it.
 *
 * @module lib/scrollbarScan
 */

/** Marks a host OverlayScrollbars has been attached to. */
export const OS_ATTR = 'data-os-init';

/**
 * The one invariant worth restating: OverlayScrollbars builds a viewport with
 * `overflow: scroll` *inside* its host. Examining that viewport would attach a
 * second instance inside the first, which builds another viewport, forever —
 * 100% CPU and memory climbing until the window dies. Every scan must refuse to
 * look inside anything OverlayScrollbars owns.
 */
const OS_INTERNAL_ATTRS = [
  'data-overlayscrollbars-viewport',
  'data-overlayscrollbars-padding',
  'data-overlayscrollbars-content',
  'data-overlayscrollbars',
];

export interface ScrollbarScanOptions {
  /** Attach OverlayScrollbars to a host that should have it. */
  attach: (el: HTMLElement, isAssetScrollContainer: boolean) => void;
  /** Selector for containers that must never be given OverlayScrollbars. */
  skipSelector: string;
  /** Selector for the Assets browser's list, which opts back in. */
  assetSelector: string;
  /** Injected for tests; defaults to the real `getComputedStyle`. */
  computeStyle?: (el: Element) => CSSStyleDeclaration;
}

export interface ScrollbarScanner {
  /**
   * Examine `root` and its descendants, skipping anything already examined.
   * Call with `document.body` once at startup and with each added subtree
   * afterwards.
   */
  scan(root: Element): void;
  /**
   * Forget `root` and its descendants, so the next `scan` re-decides them.
   * For a class or style change, whose cascade can turn a descendant
   * scrollable.
   */
  invalidate(root: Element): void;
  /** Elements examined so far. Test-only insight into how much work was done. */
  readonly examinedCount: number;
}

export function createScrollbarScanner({
  attach,
  skipSelector,
  assetSelector,
  computeStyle = (el) => getComputedStyle(el),
}: ScrollbarScanOptions): ScrollbarScanner {
  // A WeakSet, so remembering an element can never keep it alive after React
  // drops it — this is a long-lived object in a long-lived window.
  const examined = new WeakSet<Element>();
  let examinedCount = 0;

  const examine = (el: Element): void => {
    if (examined.has(el)) return;
    if (el.hasAttribute(OS_ATTR)) return;
    if (OS_INTERNAL_ATTRS.some((attr) => el.hasAttribute(attr))) return;
    if (el.closest(`[${OS_INTERNAL_ATTRS.join('], [')}]`)) return;
    if (!isHtmlElement(el)) return;

    // Marked before the style read, not after: the answer for an element that
    // is skipped is just as durable as the answer for one that is attached,
    // and it is the skipped ones that dominate.
    examined.add(el);
    examinedCount += 1;

    const isAssetScrollContainer = el.matches(assetSelector);
    // Inside a modal, overlay or dropdown, except the Assets browser, whose
    // scrollbar is deliberately an overlay.
    if (!isAssetScrollContainer && el.closest(skipSelector)) return;

    const style = computeStyle(el);
    // Intentionally hidden scrollbars stay hidden.
    if (style.scrollbarWidth === 'none') return;
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll') {
      el.setAttribute(OS_ATTR, '');
      attach(el, isAssetScrollContainer);
    }
  };

  return {
    scan(root: Element): void {
      examine(root);
      root.querySelectorAll('*').forEach(examine);
    },
    invalidate(root: Element): void {
      examined.delete(root);
      root.querySelectorAll('*').forEach((el) => examined.delete(el));
    },
    get examinedCount() {
      return examinedCount;
    },
  };
}

/**
 * `el instanceof HTMLElement` against the element's *own* document view, so
 * this still works for a node from another realm (an iframe, jsdom).
 */
function isHtmlElement(el: Element): el is HTMLElement {
  const view = el.ownerDocument?.defaultView;
  return view ? el instanceof view.HTMLElement : el instanceof HTMLElement;
}

/**
 * Which roots a batch of mutation records makes worth re-examining.
 *
 * Added nodes bring elements nobody has decided about. A changed `class` or
 * `style` can change computed overflow on the target and, through the cascade,
 * on its descendants — so the target is returned as a root to re-decide whole,
 * and the caller invalidates it first.
 *
 * Returned as two lists because they are handled differently, and because
 * keeping this a pure function is what makes the interesting part testable
 * without a DOM observer.
 */
export function rootsFromMutations(records: readonly MutationRecord[]): {
  added: Element[];
  changed: Element[];
} {
  const added = new Set<Element>();
  const changed = new Set<Element>();
  for (const record of records) {
    if (record.type === 'childList') {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) added.add(node as Element);
      });
    } else if (record.type === 'attributes' && record.target.nodeType === 1) {
      changed.add(record.target as Element);
    }
  }
  return { added: [...added], changed: [...changed] };
}
