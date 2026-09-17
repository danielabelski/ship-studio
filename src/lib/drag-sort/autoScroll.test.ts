import { describe, expect, it, vi } from 'vitest';
import { AutoScrollLoop, findScrollAncestor, scrollDelta } from './autoScroll';

describe('drag-sort auto-scroll', () => {
  it('caps edge speed and leaves the centre still', () => {
    const rect = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(scrollDelta({ x: 50, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
    expect(scrollDelta({ x: 0, y: 0 }, rect).x).toBeLessThan(0);
    expect(scrollDelta({ x: 1000, y: 1000 }, rect)).toEqual({ x: 18, y: 18 });
  });

  it('chooses the nearest scrollable ancestor', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const item = document.createElement('div');
    outer.append(inner);
    inner.append(item);
    Object.defineProperties(inner, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 200 },
    });
    Object.defineProperties(outer, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 400 },
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          overflowY: element === inner ? 'auto' : 'visible',
          overflowX: 'visible',
        }) as CSSStyleDeclaration
    );
    expect(findScrollAncestor(item)).toBe(inner);
    vi.restoreAllMocks();
  });

  it('stops its animation frame loop deterministically', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const loop = new AutoScrollLoop({ getElement: () => null, getPoint: () => null });
    loop.start();
    loop.stop();
    expect(frame).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
    vi.restoreAllMocks();
  });
});
