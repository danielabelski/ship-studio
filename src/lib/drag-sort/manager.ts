import { AutoScrollLoop } from './autoScroll';
import { collisionAt, rectFromElement, type CollisionResult } from './collision';
import { projectFlatOrder } from './reorder';
import {
  IDLE_DRAG_SORT_SNAPSHOT,
  type DragSortAnnouncements,
  type DragSortAxis,
  type DragSortId,
  type DragSortInput,
  type DragSortMove,
  type DragSortPlacement,
  type DragSortPoint,
  type DragSortRegistration,
  type DragSortSnapshot,
  type DragSortTarget,
  type DragSortValidator,
} from './types';

type Listener = () => void;
type PointerReleaseListener = (id: DragSortId) => void;
type PointerSource = HTMLElement;
const SETTLE_DURATION_MS = 250;

export interface DragSortManagerOptions {
  axis?: DragSortAxis;
  collision?: 'midpoint' | 'containment' | 'closest-center';
  canMove?: DragSortValidator;
  onMove?: (move: DragSortMove) => void | Promise<void>;
  announcements?: DragSortAnnouncements;
  reducedMotion?: () => boolean;
  /** Feature adapters may provide zone-aware placement for a target. */
  placementForTarget?: (
    target: DragSortTarget,
    point: DragSortPoint,
    axis: DragSortAxis
  ) => DragSortPlacement;
  /** Feature adapters may project a nested order without mutating source state. */
  projectOrder?: (
    order: readonly DragSortId[],
    activeId: DragSortId,
    targetId: DragSortId,
    placement: DragSortPlacement
  ) => readonly DragSortId[];
  /** Nested adapters can let the parent transform carry its descendants. */
  isPartOfActiveMove?: (activeId: DragSortId, itemId: DragSortId) => boolean;
}

interface PendingPointer {
  id: DragSortId;
  pointerId: number;
  pointerType: string;
  start: DragSortPoint;
  point: DragSortPoint;
  source: PointerSource;
  timer: number | null;
}

interface ActiveOperation {
  token: number;
  id: DragSortId;
  pointerId: number | null;
  input: DragSortInput;
  source: PointerSource;
  handle: HTMLElement | null;
  fromGroup: DragSortId;
  fromIndex: number;
  sourceOrder: readonly DragSortId[];
  projectedOrder: readonly DragSortId[];
  rects: Map<string, ReturnType<typeof rectFromElement>>;
  sourceRect: ReturnType<typeof rectFromElement>;
  offsetX: number;
  offsetY: number;
  targetId: DragSortId | null;
  placement: DragSortPlacement | null;
}

function idKey(id: DragSortId): string {
  return `${typeof id}:${String(id)}`;
}

function sameId(a: DragSortId | null, b: DragSortId | null): boolean {
  return a !== null && b !== null && idKey(a) === idKey(b);
}

function pointFromEvent(event: PointerEvent): DragSortPoint {
  return { x: event.clientX, y: event.clientY };
}

function isPromise(value: unknown): value is Promise<void> {
  return Boolean(value && typeof (value as Promise<void>).then === 'function');
}

function defaultReducedMotion(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Framework-neutral sortable interaction manager.
 *
 * Registrations are DOM handles and targets; application order is projected
 * immutably and only handed to the feature adapter once a drop is accepted.
 */
export class DragSortManager {
  private options: DragSortManagerOptions;
  private registrations = new Map<string, DragSortRegistration>();
  private listeners = new Set<Listener>();
  private pointerReleaseListeners = new Set<PointerReleaseListener>();
  private itemListeners = new Map<string, Set<Listener>>();
  private snapshot: DragSortSnapshot = IDLE_DRAG_SORT_SNAPSHOT;
  private pending: PendingPointer | null = null;
  private active: ActiveOperation | null = null;
  private autoScroll: AutoScrollLoop | null = null;
  private settleTimer: number | null = null;
  private destroyed = false;
  private previousBodyCursor = '';
  private previousBodySelection = '';
  private suppressedClick: { key: string; expiresAt: number } | null = null;
  /**
   * A settled visual operation can outlive its adapter promise. Keep the
   * promise's failure scoped to that operation so a rapid subsequent drag is
   * never interrupted by an older persistence result.
   */
  private pendingCommit: { token: number; handle: HTMLElement | null; label: string } | null = null;
  private operationToken = 0;

  constructor(options: DragSortManagerOptions = {}) {
    this.options = options;
  }

  setOptions(options: DragSortManagerOptions): void {
    this.options = { ...this.options, ...options };
  }

  getSnapshot = (): DragSortSnapshot => this.snapshot;

  subscribe = (listener: Listener, itemId?: DragSortId): (() => void) => {
    if (itemId === undefined) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    const key = idKey(itemId);
    const itemListeners = this.itemListeners.get(key) ?? new Set<Listener>();
    itemListeners.add(listener);
    this.itemListeners.set(key, itemListeners);
    return () => itemListeners.delete(listener);
  };

  /** Notify item hosts when a pointer drop has been accepted, before cleanup. */
  subscribePointerRelease = (listener: PointerReleaseListener): (() => void) => {
    this.pointerReleaseListeners.add(listener);
    return () => this.pointerReleaseListeners.delete(listener);
  };

  registerItem(registration: DragSortRegistration): () => void {
    // React StrictMode probes an effect by destroying and immediately
    // re-running it. Re-open this otherwise disposable manager when the probe
    // registers its items again; a real unmount has no references left to use.
    if (this.destroyed) this.destroyed = false;
    const key = idKey(registration.id);
    if (this.registrations.has(key)) {
      const error = new Error(`Drag-sort IDs must be unique: ${String(registration.id)}`);
      this.reportError(error.message);
      const isDevelopment = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);
      if (isDevelopment) throw error;
      return () => undefined;
    }
    this.registrations.set(key, { ...registration });
    return () => this.unregisterItem(registration.id);
  }

  updateItem(id: DragSortId, patch: Partial<DragSortRegistration>): void {
    const key = idKey(id);
    const current = this.registrations.get(key);
    if (!current) return;
    const next = { ...current, ...patch, id: current.id };
    const itemStateChanged = (Object.keys(patch) as Array<keyof DragSortRegistration>).some(
      (field) => field !== 'overlay' && !Object.is(current[field], next[field])
    );
    this.registrations.set(key, next);
    // Overlay nodes are presentation content, not item state. Updating one
    // must not fan out to every row (and an inline node may have a fresh
    // identity on each render), while geometry/eligibility changes still wake
    // this item's focused subscription.
    if (itemStateChanged) this.notifyItems([id]);
  }

  unregisterItem(id: DragSortId): void {
    const key = idKey(id);
    if (!this.registrations.delete(key)) return;
    this.itemListeners.delete(key);
    if (this.active && sameId(this.active.id, id)) this.cancel('item unmounted');
  }

  getItem(id: DragSortId): DragSortRegistration | undefined {
    return this.registrations.get(idKey(id));
  }

  /** Re-read live geometry after a consumer expands, scrolls, or resizes. */
  remeasure(): void {
    if (!this.active) return;
    this.active.rects = this.measureRects(this.active.fromGroup);
    if (this.snapshot.point) this.updateActivePoint(this.snapshot.point);
  }

  /**
   * Consume the click generated by a pointer drop. Native click dispatch can
   * happen after a reduced-motion commit has already returned the manager to
   * idle, so the primitive needs a short-lived, explicit signal rather than
   * reading the current phase alone.
   */
  consumeClick(id: DragSortId): boolean {
    const suppressed = this.suppressedClick;
    if (!suppressed) return false;
    if (suppressed.expiresAt < Date.now()) {
      this.suppressedClick = null;
      return false;
    }
    if (suppressed.key !== idKey(id)) return false;
    this.suppressedClick = null;
    return true;
  }

  getItemState(id: DragSortId): {
    isDragging: boolean;
    isTarget: boolean;
    projectedIndex: number | null;
    placement: DragSortPlacement | null;
    axis: DragSortAxis;
    transform: { x: number; y: number };
  } {
    const active = this.active;
    const projectedIndex = active
      ? active.projectedOrder.findIndex((item) => sameId(item, id))
      : -1;
    const registration = this.getItem(id);
    const measured = registration ? active?.rects.get(idKey(id)) : undefined;
    const projectedRects = active ? this.projectedRects(active) : undefined;
    const projectedRect = projectedRects?.get(idKey(id));
    const isDragging = Boolean(active && sameId(active.id, id));
    const carriedByActiveParent =
      active && !isDragging && this.options.isPartOfActiveMove?.(active.id, id);
    return {
      isDragging,
      isTarget: Boolean(this.snapshot.targetId && sameId(this.snapshot.targetId, id)),
      projectedIndex: projectedIndex >= 0 ? projectedIndex : null,
      placement:
        this.snapshot.targetId && sameId(this.snapshot.targetId, id)
          ? this.snapshot.placement
          : null,
      axis: this.options.axis ?? 'vertical',
      transform: carriedByActiveParent
        ? { x: 0, y: 0 }
        : {
            x:
              measured && projectedRect && this.options.axis === 'horizontal'
                ? projectedRect.left - measured.left
                : 0,
            y:
              measured && projectedRect && this.options.axis !== 'horizontal'
                ? projectedRect.top - measured.top
                : 0,
          },
    };
  }

  private projectedRects(active: ActiveOperation): Map<string, ReturnType<typeof rectFromElement>> {
    const rects = new Map<string, ReturnType<typeof rectFromElement>>();
    const axis = this.options.axis ?? 'vertical';
    const sourceRects = active.sourceOrder
      .map((id) => active.rects.get(idKey(id)))
      .filter((rect): rect is ReturnType<typeof rectFromElement> => Boolean(rect));
    if (sourceRects.length === 0) return rects;
    const gaps = sourceRects.slice(1).map((rect, index) => {
      const previous = sourceRects[index];
      return axis === 'horizontal' ? rect.left - previous.right : rect.top - previous.bottom;
    });
    const first = sourceRects[0];
    let cursor = axis === 'horizontal' ? first.left : first.top;
    active.projectedOrder.forEach((id, index) => {
      const rect = active.rects.get(idKey(id));
      if (!rect) return;
      const next =
        axis === 'horizontal'
          ? {
              ...rect,
              left: cursor,
              right: cursor + rect.width,
            }
          : {
              ...rect,
              top: cursor,
              bottom: cursor + rect.height,
            };
      rects.set(idKey(id), next);
      const gap = gaps[Math.min(index, Math.max(gaps.length - 1, 0))] ?? 0;
      cursor += (axis === 'horizontal' ? rect.width : rect.height) + gap;
    });
    return rects;
  }

  private measureRects(
    group: DragSortId | undefined
  ): Map<string, ReturnType<typeof rectFromElement>> {
    const rects = new Map<string, ReturnType<typeof rectFromElement>>();
    const groupKey = idKey(group ?? 'default');
    for (const registration of this.registrations.values()) {
      if (idKey(registration.group ?? 'default') !== groupKey || registration.hidden) continue;
      const element = registration.element ?? registration.target;
      if (element) rects.set(idKey(registration.id), rectFromElement(element));
    }
    return rects;
  }

  pointerDown(id: DragSortId, event: PointerEvent, source?: PointerSource): void {
    if (
      this.destroyed ||
      this.pending ||
      this.active ||
      this.snapshot.commitPending ||
      this.pendingCommit
    )
      return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    const registration = this.getItem(id);
    if (!registration || registration.disabled || this.pendingCommit) return;
    const handle = registration.handle;
    if (registration.activation !== 'item' && !handle) return;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (
      eventTarget &&
      !this.isAllowedPointerTarget(
        eventTarget,
        source ?? registration.element ?? null,
        handle ?? null
      )
    ) {
      return;
    }
    const pointerType = event.pointerType || 'mouse';
    const start = pointFromEvent(event);
    const pending: PendingPointer = {
      id,
      pointerId: event.pointerId,
      pointerType,
      start,
      point: start,
      source: source ?? handle ?? registration.element ?? (event.currentTarget as PointerSource),
      timer: null,
    };
    this.pending = pending;
    this.installPointerListeners();
    if (pointerType === 'touch' || pointerType === 'pen' || pointerType === 'stylus') {
      pending.timer = window.setTimeout(
        () => this.activatePointer(pending.point),
        pointerType === 'touch' ? 250 : 200
      );
    }
    this.setSnapshot(
      {
        ...this.snapshot,
        phase: 'pending',
        activeId: id,
        input: 'pointer',
        point: start,
        error: null,
      },
      [id]
    );
  }

  pointerMove(event: PointerEvent): void {
    if (this.pending) {
      if (this.pending.pointerId !== event.pointerId) return;
      this.pending.point = pointFromEvent(event);
      const tolerance = this.pending.pointerType === 'mouse' ? 4 : 5;
      const distance = Math.hypot(
        this.pending.point.x - this.pending.start.x,
        this.pending.point.y - this.pending.start.y
      );
      if (this.pending.pointerType !== 'mouse' && distance > tolerance) {
        this.clearPending();
        this.resetSnapshot('');
        return;
      }
      if (this.pending.pointerType === 'mouse' && distance >= tolerance) {
        this.activatePointer(this.pending.point, event);
      }
      return;
    }
    if (!this.active || this.active.pointerId !== event.pointerId || this.snapshot.commitPending) {
      return;
    }
    this.updateActivePoint(pointFromEvent(event));
  }

  pointerUp(event: PointerEvent): void {
    if (this.pending && this.pending.pointerId === event.pointerId) {
      this.clearPending();
      this.resetSnapshot('');
      return;
    }
    if (this.active && this.active.pointerId === event.pointerId) this.drop();
  }

  pointerCancel(event?: PointerEvent): void {
    if (event && this.pending && event.pointerId !== this.pending.pointerId) return;
    if (event && this.active && event.pointerId !== this.active.pointerId) return;
    this.cancel('cancelled');
  }

  lostPointerCapture(event: PointerEvent): void {
    if (this.active && this.active.pointerId === event.pointerId) {
      this.cancel('lost pointer capture');
    }
  }

  keyDown(id: DragSortId, event: KeyboardEvent): void {
    const registration = this.getItem(id);
    if (!registration || registration.disabled || this.pendingCommit) return;
    if (!this.active) {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      this.activateKeyboard(id);
      return;
    }
    if (!sameId(this.active.id, id) || this.snapshot.commitPending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel('cancelled');
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.drop();
      return;
    }
    const axis = this.options.axis ?? 'vertical';
    const previous = axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = axis === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const insideKey = axis === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const outKey = axis === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    if (
      event.key !== previous &&
      event.key !== next &&
      event.key !== insideKey &&
      event.key !== outKey &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const order = this.active.projectedOrder;
    const currentIndex = order.findIndex((item) => sameId(item, id));
    if (currentIndex < 0) return;
    let destinationIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? order.length - 1
          : currentIndex + (event.key === next || event.key === insideKey ? 1 : -1);
    const direction = destinationIndex >= currentIndex ? 1 : -1;
    while (destinationIndex >= 0 && destinationIndex < order.length) {
      const targetId = order[destinationIndex];
      if (targetId !== undefined && !sameId(targetId, id)) {
        const target = this.getItem(targetId);
        const placement: DragSortPlacement =
          event.key === insideKey ? 'inside' : destinationIndex < currentIndex ? 'before' : 'after';
        if (this.projectTo(targetId, placement, this.active.input)) return;
        if (!target?.disabled && !target?.targetDisabled) return;
      }
      destinationIndex += direction;
    }
  }

  cancel(reason = 'cancelled'): void {
    if (this.snapshot.commitPending) return;
    const active = this.active;
    this.clearPending();
    this.stopAutoScroll();
    if (!active) {
      this.resetSnapshot('');
      return;
    }
    if (active.input === 'pointer') {
      this.suppressedClick = { key: idKey(active.id), expiresAt: Date.now() + 500 };
      for (const listener of this.pointerReleaseListeners) listener(active.id);
    }
    this.releaseCapture(active);
    this.restoreBodyStyles();
    this.removePointerListeners();
    const label = this.labelOf(active.id);
    const announcement = this.options.announcements?.cancel?.(label) ?? `${label} move cancelled`;
    const reducedMotion = this.isReducedMotion();
    this.setSnapshot(
      {
        ...this.snapshot,
        phase: reducedMotion ? 'idle' : 'cancelling',
        commitPending: !reducedMotion,
        overlayRect: this.overlayRectFromSource(active),
        announcement,
      },
      active.sourceOrder
    );
    if (reducedMotion) this.finishAfterCancel(announcement);
    else {
      this.clearSettleTimer();
      this.settleTimer = window.setTimeout(
        () => this.finishAfterCancel(announcement),
        SETTLE_DURATION_MS
      );
    }
    void reason;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearPending();
    this.clearSettleTimer();
    this.stopAutoScroll();
    if (this.active) this.releaseCapture(this.active);
    this.restoreBodyStyles();
    this.removePointerListeners();
    this.listeners.clear();
    this.pointerReleaseListeners.clear();
    this.itemListeners.clear();
    this.registrations.clear();
    this.active = null;
    this.suppressedClick = null;
    this.pendingCommit = null;
  }

  private activateKeyboard(id: DragSortId): void {
    const registration = this.getItem(id);
    if (!registration) return;
    this.pendingCommit = null;
    const order = this.orderFor(registration.group);
    const sourceRect = registration.element
      ? rectFromElement(registration.element)
      : this.emptyRect();
    this.active = {
      token: ++this.operationToken,
      id,
      pointerId: null,
      input: 'keyboard',
      source: registration.handle ?? registration.element ?? document.body,
      handle: registration.handle ?? null,
      fromGroup: registration.group ?? 'default',
      fromIndex: registration.index,
      sourceOrder: order,
      projectedOrder: order,
      rects: this.measureRects(registration.group),
      sourceRect,
      offsetX: sourceRect.width / 2,
      offsetY: sourceRect.height / 2,
      targetId: null,
      placement: null,
    };
    this.setSnapshot(
      {
        ...this.snapshot,
        phase: 'dragging',
        activeId: id,
        input: 'keyboard',
        projectedOrder: order,
        overlayRect: this.overlayRectFromSource(this.active),
        announcement:
          this.options.announcements?.lift?.(
            this.labelOf(id),
            { group: registration.group ?? 'default', index: registration.index },
            order.length
          ) ?? `${this.labelOf(id)} lifted`,
        invalidReason: null,
        commitPending: false,
        error: null,
      },
      order
    );
  }

  private activatePointer(point: DragSortPoint, event?: PointerEvent): void {
    const pending = this.pending;
    if (!pending || this.active) return;
    const registration = this.getItem(pending.id);
    if (!registration) {
      this.clearPending();
      return;
    }
    this.pendingCommit = null;
    this.clearPendingTimerOnly();
    const source = pending.source;
    const sourceRect = registration.element
      ? rectFromElement(registration.element)
      : rectFromElement(source);
    this.active = {
      token: ++this.operationToken,
      id: pending.id,
      pointerId: pending.pointerId,
      input: 'pointer',
      source,
      handle: registration.handle ?? source,
      fromGroup: registration.group ?? 'default',
      fromIndex: registration.index,
      sourceOrder: this.orderFor(registration.group),
      projectedOrder: this.orderFor(registration.group),
      rects: this.measureRects(registration.group),
      sourceRect,
      offsetX: pending.start.x - sourceRect.left,
      offsetY: pending.start.y - sourceRect.top,
      targetId: null,
      placement: null,
    };
    this.pending = null;
    try {
      source.setPointerCapture?.(pending.pointerId);
      source.addEventListener('lostpointercapture', this.handleLostCapture);
    } catch {
      // Pointer capture is best-effort in test DOMs and unusual embedded views.
    }
    event?.preventDefault();
    this.saveBodyStyles();
    this.startAutoScroll();
    const label = this.labelOf(pending.id);
    this.setSnapshot(
      {
        ...this.snapshot,
        phase: 'dragging',
        activeId: pending.id,
        input: 'pointer',
        point,
        projectedOrder: this.active.projectedOrder,
        overlayRect: this.overlayRect(point),
        announcement:
          this.options.announcements?.lift?.(
            label,
            { group: registration.group ?? 'default', index: registration.index },
            this.active.sourceOrder.length
          ) ?? `${label} lifted`,
        invalidReason: null,
        commitPending: false,
        error: null,
      },
      this.active.sourceOrder
    );
    this.updateActivePoint(point);
  }

  private updateActivePoint(point: DragSortPoint): void {
    const active = this.active;
    if (!active) return;
    const previousPoint = this.snapshot.point;
    this.setSnapshot({ ...this.snapshot, point, overlayRect: this.overlayRect(point) }, [
      active.id,
    ]);
    void previousPoint;
    const target = this.findCollision(point, active);
    if (!target) {
      const projectedChanged = active.projectedOrder.some(
        (item, index) => !sameId(item, active.sourceOrder[index] ?? null)
      );
      const hadTarget = active.targetId !== null || active.placement !== null;
      active.targetId = null;
      active.placement = null;
      active.projectedOrder = active.sourceOrder;
      if (!projectedChanged && !hadTarget) return;
      this.setSnapshot(
        {
          ...this.snapshot,
          targetId: null,
          placement: null,
          projectedOrder: active.sourceOrder,
          invalidReason: null,
        },
        active.sourceOrder
      );
      return;
    }
    this.projectTo(target.id, target.placement, active.input);
  }

  private projectTo(
    targetId: DragSortId,
    placement: DragSortPlacement,
    input: DragSortInput
  ): boolean {
    const active = this.active;
    if (!active) return false;
    const target = this.getItem(targetId);
    if (!target) return false;
    const destination = {
      group: target.group ?? 'default',
      index: target.index + (placement === 'after' ? 1 : 0),
      placement,
    } as const;
    const source = this.getItem(active.id);
    if (!source) return false;
    const context = { active: source, destination, target, input };
    const validation = this.options.canMove?.(destination, context) ?? { allowed: true };
    if (validation === false || (typeof validation === 'object' && !validation.allowed)) {
      const reason =
        typeof validation === 'object' ? validation.reason : 'This destination is unavailable';
      const changedTarget =
        !sameId(active.targetId, targetId) ||
        active.placement !== placement ||
        this.snapshot.invalidReason !== reason;
      active.targetId = targetId;
      active.placement = placement;
      if (changedTarget) {
        this.setSnapshot(
          {
            ...this.snapshot,
            targetId,
            placement,
            invalidReason: reason,
            announcement:
              this.options.announcements?.invalid?.(this.labelOf(active.id), reason) ??
              `${this.labelOf(active.id)} cannot move there: ${reason}`,
          },
          [active.id, targetId]
        );
      }
      return false;
    }
    const previousTargetId = active.targetId;
    const previousPlacement = active.placement;
    const projected = this.options.projectOrder
      ? [...this.options.projectOrder(active.sourceOrder, active.id, targetId, placement)]
      : projectFlatOrder(active.sourceOrder, active.id, targetId, placement, (item) => item);
    const sameOrder =
      projected.length === active.projectedOrder.length &&
      projected.every((item, index) => sameId(item, active.projectedOrder[index] ?? null));
    active.targetId = targetId;
    active.placement = placement;
    active.projectedOrder = projected;
    if (
      sameOrder &&
      sameId(previousTargetId, targetId) &&
      previousPlacement === placement &&
      this.snapshot.invalidReason === null
    ) {
      return false;
    }
    const index = projected.findIndex((item) => sameId(item, active.id));
    const announcement =
      this.options.announcements?.move?.(
        this.labelOf(active.id),
        { group: destination.group, index, placement },
        projected.length,
        this.labelOf(targetId)
      ) ?? `${this.labelOf(active.id)} moved to position ${index + 1} of ${projected.length}`;
    this.setSnapshot(
      {
        ...this.snapshot,
        targetId,
        placement,
        projectedOrder: projected,
        invalidReason: null,
        announcement,
      },
      sameOrder
        ? [active.id, targetId, ...(previousTargetId === null ? [] : [previousTargetId])]
        : active.sourceOrder
    );
    return !sameOrder;
  }

  private drop(): void {
    const active = this.active;
    if (!active || this.snapshot.commitPending) return;
    const changed =
      active.sourceOrder.length !== active.projectedOrder.length ||
      active.sourceOrder.some((item, index) => !sameId(item, active.projectedOrder[index] ?? null));
    if (!changed || active.targetId === null || active.placement === null) {
      this.cancel('no valid destination');
      return;
    }
    const registration = this.getItem(active.id);
    if (!registration) {
      this.cancel('item unmounted');
      return;
    }
    const target = this.getItem(active.targetId);
    if (!target) {
      this.cancel('no valid destination');
      return;
    }
    const index = active.projectedOrder.findIndex((item) => sameId(item, active.id));
    const move: DragSortMove = {
      activeId: active.id,
      targetId: active.targetId,
      from: { group: active.fromGroup, index: active.fromIndex },
      to: {
        group: target.group ?? 'default',
        index,
        placement: active.placement,
      },
      input: active.input,
      projectedOrder: active.projectedOrder,
    };
    if (active.input === 'pointer') {
      this.suppressedClick = { key: idKey(active.id), expiresAt: Date.now() + 500 };
      for (const listener of this.pointerReleaseListeners) listener(active.id);
    }
    const settleRect = this.destinationOverlayRect(active);
    this.setSnapshot(
      {
        ...this.snapshot,
        phase: 'dropping',
        commitPending: true,
        overlayRect: settleRect,
        announcement:
          this.options.announcements?.drop?.(
            this.labelOf(active.id),
            move.to,
            active.projectedOrder.length
          ) ??
          `${this.labelOf(active.id)} dropped at position ${index + 1} of ${active.projectedOrder.length}`,
      },
      [active.id]
    );
    this.stopAutoScroll();
    this.releaseCapture(active);
    this.restoreBodyStyles();
    this.removePointerListeners();
    if (!this.isReducedMotion()) {
      this.clearSettleTimer();
      this.settleTimer = window.setTimeout(() => this.startCommit(move), SETTLE_DURATION_MS);
      return;
    }
    this.startCommit(move);
  }

  private startCommit(move: DragSortMove): void {
    const active = this.active;
    if (!active) return;
    const token = active.token;
    this.pendingCommit = { token, handle: active.handle, label: this.labelOf(active.id) };
    this.clearSettleTimer();
    let result: void | Promise<void>;
    try {
      result = this.options.onMove?.(move);
    } catch (error) {
      this.commitFailed(error);
      return;
    }
    if (isPromise(result)) {
      // The adapter has already received the optimistic projected order. The
      // overlay's visual settle must finish independently of persistence, so
      // remove the active operation now and only report a later rejection.
      this.finishAfterCommit(this.snapshot.announcement, true);
      result
        .then(() => this.commitSucceeded(token))
        .catch((error: unknown) => this.commitFailedAfterCleanup(token, error));
    } else {
      this.commitSucceeded(token);
    }
  }

  private commitSucceeded(token?: number): void {
    if (token !== undefined && this.pendingCommit?.token !== token) return;
    if (token !== undefined) this.pendingCommit = null;
    if (!this.active) {
      this.setSnapshot({ ...this.snapshot, commitPending: false }, []);
      return;
    }
    this.finishAfterCommit(this.snapshot.announcement);
  }

  private commitFailed(error: unknown): void {
    const active = this.active;
    if (!active) return;
    this.pendingCommit = null;
    const reason = error instanceof Error ? error.message : String(error);
    const announcement =
      this.options.announcements?.error?.(this.labelOf(active.id), reason) ??
      `${this.labelOf(active.id)} could not be moved: ${reason}`;
    this.clearSettleTimer();
    this.active = null;
    this.stopAutoScroll();
    this.releaseCapture(active);
    this.restoreBodyStyles();
    this.removePointerListeners();
    active.handle?.focus({ preventScroll: true });
    this.setSnapshot({ ...IDLE_DRAG_SORT_SNAPSHOT, announcement, error: reason }, []);
  }

  private commitFailedAfterCleanup(token: number, error: unknown): void {
    const pending = this.pendingCommit;
    if (!pending || pending.token !== token) return;
    this.pendingCommit = null;
    const reason = error instanceof Error ? error.message : String(error);
    const announcement =
      this.options.announcements?.error?.(pending.label, reason) ??
      `${pending.label} could not be moved: ${reason}`;
    pending.handle?.focus({ preventScroll: true });
    this.setSnapshot({ ...this.snapshot, commitPending: false, announcement, error: reason }, []);
  }

  private finishAfterCommit(announcement: string, commitPending = false): void {
    const active = this.active;
    if (!active) return;
    this.clearSettleTimer();
    this.stopAutoScroll();
    this.releaseCapture(active);
    this.restoreBodyStyles();
    this.removePointerListeners();
    this.active = null;
    active.handle?.focus({ preventScroll: true });
    this.setSnapshot({ ...IDLE_DRAG_SORT_SNAPSHOT, commitPending, announcement }, []);
  }

  private finishAfterCancel(announcement: string): void {
    const active = this.active;
    if (!active) return;
    this.clearSettleTimer();
    this.active = null;
    active.handle?.focus({ preventScroll: true });
    this.setSnapshot({ ...IDLE_DRAG_SORT_SNAPSHOT, announcement }, []);
  }

  private findCollision(point: DragSortPoint, active: ActiveOperation): CollisionResult | null {
    const activeRegistration = this.getItem(active.id);
    const targets: DragSortTarget[] = [...this.registrations.values()]
      .filter(
        (registration) =>
          !sameId(registration.id, active.id) &&
          (registration.group ?? 'default') === active.fromGroup
      )
      .flatMap((registration) => {
        const element = registration.target ?? registration.element;
        const measured = active.rects.get(idKey(registration.id));
        return element
          ? [
              {
                id: registration.id,
                group: registration.group ?? 'default',
                // Collisions use the captured geometry. Reading a sibling's
                // already-transformed DOM rect would move the target zone
                // underneath the pointer as projection updates, causing
                // jitter and making quarter-zone thresholds non-deterministic.
                rect: measured ?? rectFromElement(element),
                ...(registration.hidden === undefined ? {} : { hidden: registration.hidden }),
                ...(registration.targetDisabled === undefined
                  ? {}
                  : { disabled: registration.targetDisabled }),
                ...(registration.collisionPriority === undefined
                  ? {}
                  : { priority: registration.collisionPriority }),
                ...(registration.type === undefined ? {} : { type: registration.type }),
                ...(registration.acceptedTypes === undefined
                  ? {}
                  : { acceptedTypes: registration.acceptedTypes }),
              },
            ]
          : [];
      })
      .filter(
        (target) =>
          !target.acceptedTypes ||
          !activeRegistration?.type ||
          target.acceptedTypes.includes(activeRegistration.type)
      );
    if (targets.length === 0) return null;
    const crossAxis =
      this.options.axis === 'horizontal'
        ? targets.some(
            (target) => point.y >= target.rect.top - 24 && point.y <= target.rect.bottom + 24
          )
        : targets.some(
            (target) => point.x >= target.rect.left - 24 && point.x <= target.rect.right + 24
          );
    if (!crossAxis) return null;
    const result = collisionAt(
      targets,
      point,
      this.options.axis ?? 'vertical',
      this.options.collision ?? 'midpoint'
    );
    if (!result) return null;
    const resultTarget = targets.find((target) => sameId(target.id, result.id));
    if (resultTarget && this.options.placementForTarget) {
      result.placement = this.options.placementForTarget(
        resultTarget,
        point,
        this.options.axis ?? 'vertical'
      );
    }
    const axisCoordinate = this.options.axis === 'horizontal' ? point.x : point.y;
    const min =
      Math.min(
        ...targets.map((target) =>
          this.options.axis === 'horizontal' ? target.rect.left : target.rect.top
        )
      ) - 24;
    const max =
      Math.max(
        ...targets.map((target) =>
          this.options.axis === 'horizontal' ? target.rect.right : target.rect.bottom
        )
      ) + 24;
    return axisCoordinate < min || axisCoordinate > max ? null : result;
  }

  private orderFor(group: DragSortId | undefined): readonly DragSortId[] {
    const groupKey = idKey(group ?? 'default');
    return [...this.registrations.values()]
      .filter(
        (registration) =>
          idKey(registration.group ?? 'default') === groupKey && !registration.hidden
      )
      .sort((a, b) => a.index - b.index)
      .map((registration) => registration.id);
  }

  private labelOf(id: DragSortId): string {
    return this.getItem(id)?.label ?? String(id);
  }

  private overlayRect(point: DragSortPoint) {
    const active = this.active;
    if (!active) return null;
    const { sourceRect, offsetX, offsetY } = active;
    return {
      left: point.x - offsetX,
      top: point.y - offsetY,
      right: point.x - offsetX + sourceRect.width,
      bottom: point.y - offsetY + sourceRect.height,
      width: sourceRect.width,
      height: sourceRect.height,
      offsetX,
      offsetY,
    };
  }

  private overlayRectFromSource(active: ActiveOperation) {
    return {
      ...active.sourceRect,
      offsetX: active.offsetX,
      offsetY: active.offsetY,
    };
  }

  private destinationOverlayRect(active: ActiveOperation) {
    const destination = this.projectedRects(active).get(idKey(active.id));
    if (!destination) return this.snapshot.overlayRect ?? this.overlayRectFromSource(active);
    return {
      ...destination,
      offsetX: active.offsetX,
      offsetY: active.offsetY,
    };
  }

  private isReducedMotion(): boolean {
    return this.options.reducedMotion?.() ?? defaultReducedMotion();
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  private emptyRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  private isAllowedPointerTarget(
    target: Element,
    source: Element | null,
    handle: Element | null
  ): boolean {
    if (handle && (target === handle || handle.contains(target))) return true;
    if (source && target === source) return true;
    if (
      target.closest(
        '[contenteditable="true"],button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="checkbox"]'
      )
    ) {
      return false;
    }
    return Boolean(source?.contains(target));
  }

  private installPointerListeners(): void {
    window.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('resize', this.handleWindowResize);
  }

  private removePointerListeners(): void {
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  private handlePointerMove = (event: PointerEvent) => {
    this.pointerMove(event);
    if (this.active) event.preventDefault();
  };

  private handlePointerUp = (event: PointerEvent) => this.pointerUp(event);
  private handlePointerCancel = (event: PointerEvent) => this.pointerCancel(event);
  private handleLostCapture = (event: Event) => this.lostPointerCapture(event as PointerEvent);
  private handleWindowBlur = () => this.cancel('window blurred');
  private handleWindowResize = () => this.remeasure();

  private clearPendingTimerOnly(): void {
    if (!this.pending) return;
    if (this.pending.timer !== null) window.clearTimeout(this.pending.timer);
    this.pending.timer = null;
  }

  private clearPending(): void {
    this.clearPendingTimerOnly();
    this.pending = null;
  }

  private saveBodyStyles(): void {
    this.previousBodyCursor = document.body.style.cursor;
    this.previousBodySelection = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  private restoreBodyStyles(): void {
    document.body.style.cursor = this.previousBodyCursor;
    document.body.style.userSelect = this.previousBodySelection;
  }

  private releaseCapture(active: ActiveOperation): void {
    if (active.pointerId === null) return;
    try {
      active.source.removeEventListener('lostpointercapture', this.handleLostCapture);
      if (active.source.hasPointerCapture?.(active.pointerId)) {
        active.source.releasePointerCapture?.(active.pointerId);
      }
    } catch {
      // Embedded frames and jsdom can reject release after a cancelled pointer.
    }
  }

  private startAutoScroll(): void {
    if (!this.active) return;
    this.autoScroll = new AutoScrollLoop({
      getElement: () => this.active?.source ?? null,
      getPoint: () => this.snapshot.point,
      onScroll: () => {
        if (this.active && this.snapshot.point) {
          this.active.rects = this.measureRects(this.active.fromGroup);
          this.updateActivePoint(this.snapshot.point);
        }
      },
    });
    this.autoScroll.start();
  }

  private stopAutoScroll(): void {
    this.autoScroll?.stop();
    this.autoScroll = null;
  }

  private resetSnapshot(announcement: string): void {
    this.setSnapshot({ ...IDLE_DRAG_SORT_SNAPSHOT, announcement }, []);
    this.removePointerListeners();
  }

  reportError(message: string): void {
    this.setSnapshot({ ...IDLE_DRAG_SORT_SNAPSHOT, error: message, announcement: message }, []);
  }

  private setSnapshot(next: DragSortSnapshot, itemIds: readonly DragSortId[]): void {
    this.snapshot = Object.freeze(next);
    for (const listener of this.listeners) listener();
    const changed = new Set(itemIds.map(idKey));
    for (const [key, listeners] of this.itemListeners) {
      if (changed.size > 0 && !changed.has(key)) continue;
      for (const listener of listeners) listener();
    }
  }

  private notifyItems(ids: readonly DragSortId[]): void {
    const changed = new Set(ids.map(idKey));
    for (const [key, listeners] of this.itemListeners) {
      if (!changed.has(key)) continue;
      for (const listener of listeners) listener();
    }
  }
}
