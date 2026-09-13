import type { DragSortPoint } from './types';

const EDGE_DISTANCE = 40;
const MAX_SPEED = 18;

function scrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const vertical =
    /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
  const horizontal =
    /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
  return vertical || horizontal;
}

/** Return the nearest scrollable ancestor, preferring the innermost list. */
export function findScrollAncestor(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    if (scrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function scrollDelta(
  point: DragSortPoint,
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  edgeDistance = EDGE_DISTANCE,
  maxSpeed = MAX_SPEED
): { x: number; y: number } {
  const before = (distance: number) => -Math.min(maxSpeed, Math.max(0, distance) / 2);
  const after = (distance: number) => Math.min(maxSpeed, Math.max(0, distance) / 2);
  return {
    x:
      point.x < rect.left + edgeDistance
        ? before(rect.left + edgeDistance - point.x)
        : point.x > rect.right - edgeDistance
          ? after(point.x - (rect.right - edgeDistance))
          : 0,
    y:
      point.y < rect.top + edgeDistance
        ? before(rect.top + edgeDistance - point.y)
        : point.y > rect.bottom - edgeDistance
          ? after(point.y - (rect.bottom - edgeDistance))
          : 0,
  };
}

export interface AutoScrollLoopOptions {
  getElement: () => HTMLElement | null;
  getPoint: () => DragSortPoint | null;
  onScroll?: () => void;
}

/** Small rAF loop kept independent so managers can request remeasurement. */
export class AutoScrollLoop {
  private frame: number | null = null;
  private running = false;
  private readonly options: AutoScrollLoopOptions;

  constructor(options: AutoScrollLoopOptions) {
    this.options = options;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private tick = (): void => {
    if (!this.running) return;
    const element = findScrollAncestor(this.options.getElement());
    const point = this.options.getPoint();
    if (element && point) {
      const rect = element.getBoundingClientRect();
      const delta = scrollDelta(point, rect);
      if (delta.x || delta.y) {
        if (typeof element.scrollBy === 'function') {
          element.scrollBy({ left: delta.x, top: delta.y, behavior: 'auto' });
        } else {
          element.scrollLeft += delta.x;
          element.scrollTop += delta.y;
        }
        this.options.onScroll?.();
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
