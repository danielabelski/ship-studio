/** Pure pointer geometry for the two-dimensional workspace rail. */

import {
  movePanelToColumnGap,
  setFloating,
  stackPanel,
  type PanelId,
  type WorkspaceLayout,
} from './workspaceLayout';

export const SNAP_PX = 24;

export interface RailColumnRect {
  columnIndex: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  preview?: boolean;
}

export interface RailPanelRect {
  panel: PanelId;
  columnIndex: number;
  panelIndex: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RailBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RailGeometry {
  columns: RailColumnRect[];
  panels: RailPanelRect[];
  bounds: RailBounds;
}

export type DropTarget =
  | {
      kind: 'column';
      beforeColumn: number | null;
      x: number;
      top: number;
      bottom: number;
    }
  | {
      kind: 'stack';
      columnIndex: number;
      /** Insert before this panel, or after the stack when null. */
      beforePanel: PanelId | null;
      /** The panel immediately above the append boundary, for the hint. */
      afterPanel: PanelId | null;
      left: number;
      right: number;
      y: number;
      top: number;
      bottom: number;
    }
  | { kind: 'float' };

function columnBoundaries(columns: RailColumnRect[], bounds: RailBounds) {
  if (columns.length === 0) return [{ x: bounds.left, beforeColumn: null as number | null }];
  const ordered = [...columns].sort((a, b) => a.left - b.left);
  const result: { x: number; beforeColumn: number | null }[] = [
    { x: ordered[0].left, beforeColumn: ordered[0].columnIndex },
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    result.push({
      x: (ordered[index - 1].right + ordered[index].left) / 2,
      beforeColumn: ordered[index].columnIndex,
    });
  }
  result.push({ x: ordered[ordered.length - 1].right, beforeColumn: null });
  return result;
}

function stackBoundaries(stack: RailPanelRect[]) {
  const ordered = [...stack].sort((a, b) => a.top - b.top);
  if (ordered.length === 0) return [];

  return [
    ...ordered.map((panel) => ({
      y: panel.top,
      beforePanel: panel.panel,
      afterPanel: null as PanelId | null,
    })),
    {
      y: ordered[ordered.length - 1].bottom,
      beforePanel: null,
      afterPanel: ordered[ordered.length - 1].panel,
    },
  ];
}

/** Resolve a pointer into a new-column seam, stack insertion, or float. */
export function dropTargetAt(
  geometry: RailGeometry,
  point: { x: number; y: number },
  snapPx: number = SNAP_PX
): DropTarget {
  const { columns, panels, bounds } = geometry;
  if (point.y < bounds.top || point.y > bounds.bottom) return { kind: 'float' };

  // Seams have priority. This is what lets a user pull a panel out of a stack
  // by aiming at the rail edge without accidentally stacking it.
  let nearest: { x: number; beforeColumn: number | null } | null = null;
  let distance = Infinity;
  for (const boundary of columnBoundaries(columns, bounds)) {
    const nextDistance = Math.abs(point.x - boundary.x);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = boundary;
    }
  }
  if (nearest && distance <= snapPx) {
    return {
      kind: 'column',
      beforeColumn: nearest.beforeColumn,
      x: nearest.x,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  }

  const column = columns.find(
    (candidate) =>
      point.x >= candidate.left &&
      point.x <= candidate.right &&
      point.y >= candidate.top &&
      point.y <= candidate.bottom
  );
  if (!column || column.preview) return { kind: 'float' };

  const stack = panels
    .filter((panel) => panel.columnIndex === column.columnIndex)
    .sort((a, b) => a.top - b.top);
  if (stack.length === 0) return { kind: 'float' };

  let nearestStackBoundary:
    | (ReturnType<typeof stackBoundaries>[number] & { distance: number })
    | null = null;
  for (const boundary of stackBoundaries(stack)) {
    const distance = Math.abs(point.y - boundary.y);
    if (!nearestStackBoundary || distance < nearestStackBoundary.distance) {
      nearestStackBoundary = { ...boundary, distance };
    }
  }
  if (!nearestStackBoundary || nearestStackBoundary.distance > snapPx) {
    return { kind: 'float' };
  }
  return {
    kind: 'stack',
    columnIndex: column.columnIndex,
    beforePanel: nearestStackBoundary.beforePanel,
    afterPanel: nearestStackBoundary.afterPanel,
    left: column.left,
    right: column.right,
    y: nearestStackBoundary.y,
    top: column.top,
    bottom: column.bottom,
  };
}

export function applyDrop(
  layout: WorkspaceLayout,
  panel: PanelId,
  target: DropTarget
): WorkspaceLayout {
  if (target.kind === 'float') return setFloating(layout, panel, true);
  if (target.kind === 'column') {
    return movePanelToColumnGap(
      layout,
      panel,
      target.beforeColumn === null ? layout.columns.length : target.beforeColumn
    );
  }
  if (target.beforePanel !== null) return stackPanel(layout, panel, target.beforePanel, 'before');
  if (target.afterPanel !== null) return stackPanel(layout, panel, target.afterPanel, 'after');
  return layout;
}

export function describeDrop(
  target: DropTarget,
  labelOf: (panel: PanelId) => string,
  columnLabel?: (column: number | null) => string
): string {
  if (target.kind === 'float') return 'Float';
  if (target.kind === 'column') {
    return target.beforeColumn === null
      ? 'New column at the far right'
      : `New column ${columnLabel?.(target.beforeColumn) ?? 'here'}`;
  }
  if (target.beforePanel !== null) return `Above ${labelOf(target.beforePanel)} · same column`;
  return target.afterPanel === null
    ? 'Stack in this column'
    : `Below ${labelOf(target.afterPanel)} · same column`;
}

export function railBoundaries(columns: RailColumnRect[], bounds: RailBounds) {
  return columnBoundaries(columns, bounds);
}
