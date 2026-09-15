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
      expect(manager.getItemState('a').suppressTransition).toBe(true);
      expect(manager.getItemState('b').suppressTransition).toBe(true);
      vi.advanceTimersByTime(32);
      expect(manager.getItemState('a').suppressTransition).toBe(false);
      expect(manager.getItemState('b').suppressTransition).toBe(false);
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a stale projection and cancels when the current target is invalid', () => {
    const moves = vi.fn();
    const { manager, elements } = setup({
      onMove: moves,
      reducedMotion: () => true,
      canMove: (_destination, context) =>
        context.target?.id === 'c' ? { allowed: false, reason: 'locked' } : { allowed: true },
    });

    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 45));
    expect(manager.getSnapshot().projectedOrder).toEqual(['b', 'a', 'c']);

    manager.pointerMove(pointer('pointermove', 1, 10, 70));
    expect(manager.getSnapshot()).toMatchObject({
      targetId: 'c',
      invalidReason: 'locked',
      projectedOrder: ['a', 'b', 'c'],
    });

    manager.pointerUp(pointer('pointerup', 1, 10, 70));
    expect(moves).not.toHaveBeenCalled();
    expect(manager.getSnapshot().phase).toBe('idle');
    manager.destroy();
  });

  it('commits an adapter-reported hierarchy change when flat order is unchanged', () => {
    const moves = vi.fn();
    const { manager, elements } = setup({
      onMove: moves,
      reducedMotion: () => true,
      placementForTarget: () => 'before',
      projectOrder: (order) => order,
      hasProjectedMove: () => true,
    });

    manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 40));
    manager.pointerUp(pointer('pointerup', 1, 10, 40));

    expect(moves).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'b', projectedOrder: ['a', 'b', 'c'] })
    );
    manager.destroy();
  });

  it('requires a pointer hold before an inside placement becomes ready', () => {
    vi.useFakeTimers();
    try {
      const moves = vi.fn();
      const { manager, elements } = setup({
        onMove: moves,
        reducedMotion: () => true,
        insideHoldDelayMs: 500,
        insideHoldFlashDurationMs: 150,
        placementForTarget: () => 'inside',
        projectOrder: (order) => [...order],
      });
      manager.pointerDown('c', pointer('pointerdown', 1, 10, 70), elements[2].element);
      manager.pointerMove(pointer('pointermove', 1, 10, 40));

      expect(manager.getSnapshot()).toMatchObject({
        targetId: 'b',
        placement: 'inside',
        insideHold: 'pending',
        projectedOrder: ['a', 'b', 'c'],
      });
      vi.advanceTimersByTime(499);
      expect(manager.getSnapshot().insideHold).toBe('pending');
      expect(moves).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(manager.getSnapshot().insideHold).toBe('flashing');
      expect(manager.getSnapshot().projectedOrder).toEqual(['a', 'b', 'c']);
      vi.advanceTimersByTime(150);
      expect(manager.getSnapshot()).toMatchObject({
        targetId: 'b',
        placement: 'inside',
        insideHold: 'ready',
        projectedOrder: ['a', 'b', 'c'],
      });

      manager.pointerUp(pointer('pointerup', 1, 10, 40));
      expect(moves).toHaveBeenCalledTimes(1);
      const committedMove = moves.mock.calls[0]?.[0] as
        | { targetId?: string; to?: { placement?: string } }
        | undefined;
      expect(committedMove?.targetId).toBe('b');
      expect(committedMove?.to?.placement).toBe('inside');
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not nest when the pointer leaves or releases during the hold', () => {
    vi.useFakeTimers();
    try {
      const moves = vi.fn();
      const { manager, elements } = setup({
        onMove: moves,
        reducedMotion: () => true,
        insideHoldDelayMs: 500,
        hasProjectedMove: () => true,
        placementForTarget: () => 'inside',
      });
      manager.pointerDown('a', pointer('pointerdown', 1, 10, 10), elements[0].element);
      manager.pointerMove(pointer('pointermove', 1, 10, 40));
      manager.pointerMove(pointer('pointermove', 1, 10, 200));
      expect(manager.getSnapshot().insideHold).toBe('idle');
      manager.pointerUp(pointer('pointerup', 1, 10, 200));
      expect(moves).not.toHaveBeenCalled();
      expect(manager.getSnapshot().phase).toBe('idle');

      manager.pointerDown('a', pointer('pointerdown', 2, 10, 10), elements[0].element);
      manager.pointerMove(pointer('pointermove', 2, 10, 40));
      manager.pointerUp(pointer('pointerup', 2, 10, 40));
      expect(moves).not.toHaveBeenCalled();
      manager.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the projected destination active while the pointer crosses its empty row', () => {
    const { manager, elements } = setup({ reducedMotion: () => true });
    manager.pointerDown('c', pointer('pointerdown', 1, 10, 70), elements[2].element);
    manager.pointerMove(pointer('pointermove', 1, 10, 30));
    expect(manager.getSnapshot()).toMatchObject({
      targetId: 'b',
      placement: 'before',
      projectedOrder: ['a', 'c', 'b'],
    });

    // The pointer is now over the projected empty row for `c`, while the
    // captured pre-drag geometry still says it is over the middle of `b`.
    manager.pointerMove(pointer('pointermove', 1, 10, 40));
    expect(manager.getSnapshot()).toMatchObject({
      targetId: 'b',
      placement: 'before',
      projectedOrder: ['a', 'c', 'b'],
    });

    manager.cancel();
    manager.destroy();
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

  it('supports whole-item activation without a handle and restores item focus', () => {
    const manager = new DragSortManager({ reducedMotion: () => true });
    const item = document.createElement('div');
    item.tabIndex = 0;
    document.body.append(item);
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(0) as DOMRect);
    manager.registerItem({
      id: 'item',
      index: 0,
      group: 'list',
      element: item,
      target: item,
      activation: 'item',
      label: 'item',
    });

    item.focus();
    manager.keyDown('item', new KeyboardEvent('keydown', { key: ' ' }));
    expect(manager.getSnapshot().phase).toBe('dragging');
    manager.cancel();
    expect(document.activeElement).toBe(item);
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

  it('does not treat an enclosing tree subtree as a target at pickup', () => {
    const manager = new DragSortManager({ collision: 'containment', reducedMotion: () => true });
    const container = document.createElement('div');
    document.body.append(container);
    const makeElement = (top: number, height: number) => {
      const element = document.createElement('div');
      container.append(element);
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top,
        right: 100,
        bottom: top + height,
        width: 100,
        height,
      } as DOMRect);
      return element;
    };

    const parent = makeElement(0, 100);
    const parentRow = makeElement(0, 20);
    const active = makeElement(30, 20);
    const activeRow = makeElement(30, 20);
    const sibling = makeElement(60, 20);
    const siblingRow = makeElement(60, 20);
    manager.registerItem({
      id: 'parent',
      index: 0,
      group: 'tree',
      element: parent,
      target: parentRow,
    });
    manager.registerItem({
      id: 'active',
      index: 1,
      group: 'tree',
      element: active,
      target: activeRow,
      activation: 'item',
    });
    manager.registerItem({
      id: 'sibling',
      index: 2,
      group: 'tree',
      element: sibling,
      target: siblingRow,
    });

    manager.pointerDown('active', pointer('pointerdown', 1, 10, 40), active);
    manager.pointerMove(pointer('pointermove', 1, 10, 45));

    expect(manager.getSnapshot().targetId).toBeNull();
    expect(manager.getSnapshot().projectedOrder).toEqual(['parent', 'active', 'sibling']);
    expect(manager.getItemState('parent').transform).toEqual({ x: 0, y: 0 });
    expect(manager.getItemState('sibling').transform).toEqual({ x: 0, y: 0 });

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
    // Carried descendants are omitted from the sortable projection and from
    // collision candidates; the adapter renders them as part of the parent.
    expect(manager.getSnapshot().projectedOrder).toEqual(['c', 'a']);
    expect(manager.getSnapshot().targetId).toBe('c');
    expect(manager.getItemState('b').transform).toEqual({ x: 0, y: 0 });
    expect(manager.getItemState('c').transform.y).toBe(-60);
    manager.cancel();
    manager.destroy();
  });
});
