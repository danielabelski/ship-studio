import { describe, expect, it, vi } from 'vitest';
import { DragSortManager } from './manager';

function rect(top: number) {
  return { left: 0, top, right: 100, bottom: top + 20, width: 100, height: 20 };
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId: number,
  x: number,
  y: number,
  pointerType = 'mouse'
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

function setup(options: ConstructorParameters<typeof DragSortManager>[0] = {}) {
  const manager = new DragSortManager(options);
  const container = document.createElement('div');
  document.body.append(container);
  const elements = ['a', 'b', 'c'].map((id, index) => {
    const element = document.createElement('div');
    const handle = document.createElement('button');
    element.append(handle);
    container.append(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(index * 30) as DOMRect);
    manager.registerItem({ id, index, group: 'list', element, handle, target: element, label: id });
    return { element, handle };
  });
  return { manager, elements };
}

describe('DragSortManager', () => {
  it('keeps a click below the mouse threshold as a click', () => {
    const { manager, elements } = setup();
    const moves = vi.fn();
    manager.setOptions({ onMove: moves });
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 12, 12));
    manager.pointerUp(pointer('pointerup', 1, 12, 12));
    expect(moves).not.toHaveBeenCalled();
    expect(manager.getSnapshot().phase).toBe('idle');
    manager.destroy();
  });

  it('suppresses the click emitted after an activated pointer drag is cancelled', () => {
    const { manager, elements } = setup({ reducedMotion: () => true });
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 55));
    manager.cancel('no valid destination');
    expect(manager.consumeClick('a')).toBe(true);
    expect(manager.consumeClick('a')).toBe(false);
    manager.destroy();
  });

  it('projects at a midpoint and commits once after the settle duration', () => {
    vi.useFakeTimers();
    const moves = vi.fn();
    try {
      const { manager, elements } = setup({ onMove: moves, reducedMotion: () => false });
      manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
      manager.pointerMove(pointer('pointermove', 1, 10, 55));
      expect(manager.getSnapshot().projectedOrder).toEqual(['b', 'a', 'c']);
      manager.pointerUp(pointer('pointerup', 1, 10, 55));
      expect(moves).not.toHaveBeenCalled();
      expect(manager.getSnapshot().phase).toBe('dropping');
      vi.advanceTimersByTime(249);
      expect(moves).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(moves).toHaveBeenCalledTimes(1);
      expect(moves).toHaveBeenCalledWith(
        expect.objectContaining({ projectedOrder: ['b', 'a', 'c'] })
      );
      expect(manager.getSnapshot().phase).toBe('idle');
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles cancellation back to the source before cleanup', () => {
    vi.useFakeTimers();
    try {
      const { manager, elements } = setup({ reducedMotion: () => false });
      manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
      manager.pointerMove(pointer('pointermove', 1, 10, 55));
      manager.cancel();
      expect(manager.getSnapshot().phase).toBe('cancelling');
      expect(manager.getSnapshot().overlayRect?.top).toBe(0);
      vi.advanceTimersByTime(249);
      expect(manager.getSnapshot().phase).toBe('cancelling');
      vi.advanceTimersByTime(1);
      expect(manager.getSnapshot().phase).toBe('idle');
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits immediately when reduced motion is enabled', () => {
    const moves = vi.fn();
    const { manager, elements } = setup({ onMove: moves, reducedMotion: () => true });
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 55));
    manager.pointerUp(pointer('pointerup', 1, 10, 55));
    expect(moves).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().phase).toBe('idle');
    manager.destroy();
  });

  it('starts the async commit at the end of settle and removes the overlay immediately', async () => {
    vi.useFakeTimers();
    let resolveCommit: (() => void) | undefined;
    try {
      const onMove = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCommit = resolve;
          })
      );
      const { manager, elements } = setup({ onMove, reducedMotion: () => false });
      manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
      manager.pointerMove(pointer('pointermove', 1, 10, 55));
      manager.pointerUp(pointer('pointerup', 1, 10, 55));
      expect(manager.getSnapshot().phase).toBe('dropping');
      expect(onMove).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot().commitPending).toBe(true);
      expect(manager.getSnapshot().phase).toBe('idle');
      expect(manager.getSnapshot().overlayRect).toBeNull();
      manager.pointerDown('b', pointer('pointerdown', 1, 10, 40), elements[1].element);
      expect(manager.getSnapshot().phase).toBe('idle');
      resolveCommit?.();
      await Promise.resolve();
      expect(manager.getSnapshot().commitPending).toBe(false);
      manager.pointerDown('b', pointer('pointerdown', 2, 10, 40), elements[1].element);
      expect(manager.getSnapshot().phase).toBe('pending');
      manager.cancel();
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludes interactive descendants unless the registered handle is used', () => {
    const { manager, elements } = setup();
    const buttonEvent = pointer('pointerdown', 1, 10, 10);
    Object.defineProperty(buttonEvent, 'target', { value: elements[0].handle });
    manager.pointerDown('a', buttonEvent, elements[0].element);
    expect(manager.getSnapshot().phase).toBe('pending');
    manager.cancel();

    const nested = document.createElement('button');
    elements[0].element.append(nested);
    const nestedEvent = pointer('pointerdown', 2, 10, 10);
    Object.defineProperty(nestedEvent, 'target', { value: nested });
    manager.pointerDown('a', nestedEvent, elements[0].element);
    expect(manager.getSnapshot().phase).toBe('idle');
    manager.destroy();
  });

  it('supports keyboard movement, Escape rollback, and focus restoration', () => {
    const { manager, elements } = setup({ reducedMotion: () => true });
    elements[0].handle.focus();
    const lift = new KeyboardEvent('keydown', { key: ' ' });
    manager.keyDown('a', lift);
    manager.keyDown('a', new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(manager.getSnapshot().projectedOrder).toEqual(['b', 'a', 'c']);
    manager.keyDown('a', new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(manager.getSnapshot().phase).toBe('idle');
    expect(document.activeElement).toBe(elements[0].handle);
    manager.destroy();
  });

  it('uses the tree-equivalent keyboard placement zones', () => {
    const { manager, elements } = setup({ reducedMotion: () => true });
    elements[0].handle.focus();
    manager.keyDown('a', new KeyboardEvent('keydown', { key: ' ' }));
    manager.keyDown('a', new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(manager.getSnapshot().placement).toBe('inside');
    expect(manager.getSnapshot().targetId).toBe('b');
    manager.keyDown('a', new KeyboardEvent('keydown', { key: 'Escape' }));
    manager.destroy();
  });

  it('finishes visual settle without awaiting persistence and reports later failures', async () => {
    let rejectCommit: ((reason?: unknown) => void) | undefined;
    const onMove = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectCommit = reject;
        })
    );
    const { manager, elements } = setup({ onMove, reducedMotion: () => true });
    elements[0].handle.focus();
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 55));
    manager.pointerUp(pointer('pointerup', 1, 10, 55));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().phase).toBe('idle');
    expect(manager.getSnapshot().commitPending).toBe(true);
    expect(manager.getSnapshot().overlayRect).toBeNull();
    manager.pointerDown('b', pointer('pointerdown', 2, 10, 40), elements[1].element);
    expect(manager.getSnapshot().phase).toBe('idle');
    rejectCommit?.(new Error('storage unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getSnapshot().error).toBe('storage unavailable');
    expect(manager.getSnapshot().commitPending).toBe(false);
    expect(manager.getSnapshot().projectedOrder).toBeNull();
    expect(document.activeElement).toBe(elements[0].handle);
    manager.pointerDown('b', pointer('pointerdown', 2, 10, 40), elements[1].element);
    expect(manager.getSnapshot().phase).toBe('pending');
    manager.cancel();
    manager.destroy();
  });

  it('translates mixed-height rows using captured rectangles and exposes placement', () => {
    const manager = new DragSortManager({ reducedMotion: () => true });
    const container = document.createElement('div');
    document.body.append(container);
    const measurements = [
      { top: 0, height: 20 },
      { top: 35, height: 40 },
      { top: 100, height: 10 },
    ];
    const elements = ['a', 'b', 'c'].map((id, index) => {
      const element = document.createElement('div');
      const handle = document.createElement('button');
      element.append(handle);
      container.append(element);
      const measured = measurements[index];
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: measured.top,
        right: 100,
        bottom: measured.top + measured.height,
        width: 100,
        height: measured.height,
      } as DOMRect);
      manager.registerItem({
        id,
        index,
        group: 'list',
        element,
        handle,
        target: element,
        label: id,
      });
      return element;
    });
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0]);
    manager.pointerMove(pointer('pointermove', 1, 10, 106));
    expect(manager.getSnapshot().projectedOrder).toEqual(['b', 'c', 'a']);
    expect(manager.getItemState('a').transform.y).toBe(90);
    expect(manager.getItemState('b').transform.y).toBe(-35);
    expect(manager.getItemState('c').transform.y).toBe(-45);
    expect(manager.getItemState('c').placement).toBe('after');
    manager.cancel();
    manager.destroy();
  });

  it('lets a nested adapter carry descendant rows with the active parent', () => {
    const { manager, elements } = setup({
      reducedMotion: () => true,
      isPartOfActiveMove: (activeId, itemId) => activeId === 'a' && itemId === 'b',
    });
    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 85));
    expect(manager.getSnapshot().projectedOrder).toEqual(['b', 'c', 'a']);
    expect(manager.getItemState('b').transform).toEqual({ x: 0, y: 0 });
    expect(manager.getItemState('c').transform.y).toBe(-30);
    manager.cancel();
    manager.destroy();
  });
});
