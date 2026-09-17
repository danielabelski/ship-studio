import { describe, expect, it } from 'vitest';
import { projectFlatOrder, projectGroupedOrder, projectTree, reorderFlat } from './reorder';

const ids = (values: readonly { id: string }[]) => values.map((value) => value.id);

describe('drag-sort reorder projection', () => {
  it('moves a flat item immutably before and after a target', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(ids(projectFlatOrder(input, 'a', 'c', 'before'))).toEqual(['b', 'a', 'c']);
    expect(ids(projectFlatOrder(input, 'c', 'a', 'before'))).toEqual(['c', 'a', 'b']);
    expect(input.map((value) => value.id)).toEqual(['a', 'b', 'c']);
  });

  it('compensates source removal and handles no-op/end indexes', () => {
    expect(ids(reorderFlat([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, 0))).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(ids(projectFlatOrder([{ id: 'a' }, { id: 'b' }], 'a', 'a', 'before'))).toEqual([
      'a',
      'b',
    ]);
  });

  it('moves between groups without mutating either source group', () => {
    const input = { left: [{ id: 'a' }, { id: 'b' }], right: [] as { id: string }[] };
    const output = projectGroupedOrder(input, {
      activeId: 'b',
      from: { group: 'left', index: 1 },
      to: { group: 'right', index: 0 },
    });
    expect(ids(output.left)).toEqual(['a']);
    expect(ids(output.right)).toEqual(['b']);
    expect(ids(input.left)).toEqual(['a', 'b']);
  });

  it('uses the final destination index for same-group moves', () => {
    const output = projectGroupedOrder(
      { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      { activeId: 'b', from: { group: 'list', index: 1 }, to: { group: 'list', index: 2 } }
    );
    expect(ids(output.list)).toEqual(['a', 'c', 'b']);
  });

  it('rejects duplicate IDs across groups', () => {
    expect(() =>
      projectGroupedOrder(
        { left: [{ id: 'a' }], right: [{ id: 'a' }] },
        { activeId: 'a', from: { group: 'left', index: 0 }, to: { group: 'right', index: 0 } }
      )
    ).toThrow('unique');
  });

  it('projects a tree before, inside, and after without changing the input', () => {
    const input = [{ id: 'a', children: [{ id: 'child' }] }, { id: 'b' }];
    expect(projectTree(input, 'b', 'a', 'before').map((node) => node.id)).toEqual(['b', 'a']);
    expect(projectTree(input, 'b', 'a', 'inside')[0]?.children?.map((node) => node.id)).toEqual([
      'child',
      'b',
    ]);
    expect(projectTree(input, 'b', 'a', 'after').map((node) => node.id)).toEqual(['a', 'b']);
    expect(input.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('rejects duplicate stable ids instead of choosing one silently', () => {
    expect(() => projectFlatOrder([{ id: 'a' }, { id: 'a' }], 'a', 'a', 'before')).toThrow(
      'unique'
    );
  });

  it('preserves the active node when a tree target is absent', () => {
    const input = [{ id: 'a', children: [{ id: 'child' }] }, { id: 'b' }];
    const output = projectTree(input, 'b', 'missing', 'after');
    expect(output.map((node) => node.id)).toEqual(['a', 'b']);
    expect(output[0]?.children?.map((node) => node.id)).toEqual(['child']);
  });
});
