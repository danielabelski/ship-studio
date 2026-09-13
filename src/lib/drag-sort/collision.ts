import type {
  DragSortAxis,
  DragSortId,
  DragSortPoint,
  DragSortRect,
  DragSortTarget,
  DragSortPlacement,
} from './types';

export type { DragSortTarget } from './types';

export interface CollisionResult {
  id: DragSortId;
  placement: DragSortPlacement;
  distance: number;
  priority: number;
}

export function rectFromElement(element: Element): DragSortRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function midpoint(rect: DragSortRect, axis: DragSortAxis): number {
  return axis === 'vertical' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
}

export function centerDistance(rect: DragSortRect, point: DragSortPoint): number {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return Math.hypot(point.x - x, point.y - y);
}

export function containsPoint(rect: DragSortRect, point: DragSortPoint): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

/** Directional midpoint collision for ordinary flat lists. */
export function midpointCollision(
  targets: readonly DragSortTarget[],
  point: DragSortPoint,
  axis: DragSortAxis
): CollisionResult | null {
  const candidates = targets.filter((target) => !target.hidden && !target.disabled);
  if (candidates.length === 0) return null;
  const coordinate = axis === 'vertical' ? point.y : point.x;
  const ordered = [...candidates].sort((a, b) => {
    const aMid = midpoint(a.rect, axis);
    const bMid = midpoint(b.rect, axis);
    return Math.abs(coordinate - aMid) - Math.abs(coordinate - bMid);
  });
  const target = ordered[0];
  if (!target) return null;
  const targetMid = midpoint(target.rect, axis);
  return {
    id: target.id,
    placement: coordinate < targetMid ? 'before' : 'after',
    distance: Math.abs(coordinate - targetMid),
    priority: target.priority ?? 0,
  };
}

/** Closest centre collision is deterministic for keyboard movement. */
export function closestCenterCollision(
  targets: readonly DragSortTarget[],
  point: DragSortPoint
): CollisionResult | null {
  return (
    targets
      .filter((target) => !target.hidden && !target.disabled)
      .map((target) => ({
        id: target.id,
        placement: 'after' as const,
        distance: centerDistance(target.rect, point),
        priority: target.priority ?? 0,
      }))
      .sort((a, b) => b.priority - a.priority || a.distance - b.distance)[0] ?? null
  );
}

/** Nested-target collision: containment first, explicit priority, then area. */
export function containmentCollision(
  targets: readonly DragSortTarget[],
  point: DragSortPoint,
  axis: DragSortAxis = 'vertical'
): CollisionResult | null {
  const contained = targets
    .filter((target) => !target.hidden && !target.disabled && containsPoint(target.rect, point))
    .map((target) => ({
      target,
      area: Math.max(0, target.rect.width) * Math.max(0, target.rect.height),
    }))
    .sort((a, b) => (b.target.priority ?? 0) - (a.target.priority ?? 0) || a.area - b.area);
  const candidate = contained[0]?.target;
  if (!candidate) return null;
  const coordinate = axis === 'vertical' ? point.y : point.x;
  return {
    id: candidate.id,
    placement: coordinate < midpoint(candidate.rect, axis) ? 'before' : 'after',
    distance: centerDistance(candidate.rect, point),
    priority: candidate.priority ?? 0,
  };
}

export function collisionAt(
  targets: readonly DragSortTarget[],
  point: DragSortPoint,
  axis: DragSortAxis,
  mode: 'midpoint' | 'containment' | 'closest-center' = 'midpoint'
): CollisionResult | null {
  if (mode === 'containment') return containmentCollision(targets, point, axis);
  if (mode === 'closest-center') return closestCenterCollision(targets, point);
  return midpointCollision(targets, point, axis) ?? closestCenterCollision(targets, point);
}
