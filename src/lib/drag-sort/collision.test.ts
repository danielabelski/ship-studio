import { describe, expect, it } from 'vitest';
import {
  closestCenterCollision,
  collisionAt,
  containmentCollision,
  midpointCollision,
  type DragSortTarget,
} from './collision';

const target = (id: string, top: number, height = 20, priority = 0): DragSortTarget => ({
  id,
  group: 'list',
  rect: { left: 0, top, right: 100, bottom: top + height, width: 100, height },
  priority,
});

describe('drag-sort collision', () => {
  const rows = [target('a', 0), target('b', 30, 40), target('c', 90, 10)];

  it('switches at each measured vertical midpoint', () => {
    expect(midpointCollision(rows, { x: 20, y: 48 }, 'vertical')?.id).toBe('b');
    expect(midpointCollision(rows, { x: 20, y: 48 }, 'vertical')?.placement).toBe('before');
    expect(midpointCollision(rows, { x: 20, y: 70 }, 'vertical')?.placement).toBe('after');
  });

  it('supports horizontal midpoint and closest-centre fallback', () => {
    const horizontal = rows.map((row) => ({
      ...row,
      rect: {
        ...row.rect,
        left: row.rect.top,
        right: row.rect.top + row.rect.height,
        top: 0,
        bottom: 100,
        width: row.rect.height,
      },
    }));
    expect(collisionAt(horizontal, { x: 55, y: 50 }, 'horizontal')?.id).toBe('b');
    expect(closestCenterCollision(rows, { x: 50, y: 105 })?.id).toBe('c');
  });

  it('gives explicit priority to the smallest overlapping nested target', () => {
    const nested = [
      { ...target('outer', 0, 100), priority: 1 },
      { ...target('inner', 20, 20), priority: 5 },
    ];
    expect(containmentCollision(nested, { x: 50, y: 30 })?.id).toBe('inner');
  });

  it('skips hidden and disabled targets', () => {
    expect(
      midpointCollision(
        [{ ...target('hidden', 0), hidden: true }, { ...target('ok', 30) }],
        { x: 1, y: 2 },
        'vertical'
      )?.id
    ).toBe('ok');
  });
});
