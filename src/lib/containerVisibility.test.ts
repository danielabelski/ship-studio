import { describe, it, expect, afterEach } from 'vitest';
import { diagnoseZeroSizedContainer, isLegitimatelyHiddenPane } from './containerVisibility';

/**
 * jsdom has no real layout engine, so it can never compute `offsetParent`
 * from CSS the way a real browser does — it's always `null`. Stub it
 * directly to exercise both branches of the "in the layout tree or not"
 * check the same way `dropTarget.ts`'s drag-drop routing relies on it.
 */
function stubOffsetParent(el: HTMLElement, value: Element | null) {
  Object.defineProperty(el, 'offsetParent', { value, configurable: true });
}

describe('containerVisibility (#863)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads computed visibility instead of the (always-empty) inline style.display the old diagnostic used', () => {
    const el = document.createElement('div');
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    stubOffsetParent(el, document.body);

    const diagnostics = diagnoseZeroSizedContainer(el);
    expect(diagnostics.visibility).toBe('hidden');
    expect(diagnostics.offsetParentIsNull).toBe(false);
    expect(isLegitimatelyHiddenPane(diagnostics)).toBe(true);
  });

  it('flags a display:none ancestor (offsetParent === null) as legitimately hidden', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    stubOffsetParent(el, null);

    const diagnostics = diagnoseZeroSizedContainer(el);
    expect(diagnostics.offsetParentIsNull).toBe(true);
    expect(isLegitimatelyHiddenPane(diagnostics)).toBe(true);
  });

  it('does NOT flag a visible, in-layout container as hidden — a genuine stall', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    stubOffsetParent(el, document.body);

    const diagnostics = diagnoseZeroSizedContainer(el);
    expect(diagnostics.offsetParentIsNull).toBe(false);
    expect(diagnostics.visibility).toBe('visible');
    expect(isLegitimatelyHiddenPane(diagnostics)).toBe(false);
  });
});
