import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefCallback,
} from 'react';
import { useDragSortContext } from '../contexts/DragSortContext';
import type { DragSortActivation, DragSortId } from '../lib/drag-sort/types';

export interface UseDragSortItemOptions {
  id: DragSortId;
  group?: DragSortId;
  index: number;
  label?: string;
  type?: string;
  acceptedTypes?: readonly string[];
  disabled?: boolean;
  hidden?: boolean;
  targetDisabled?: boolean;
  collisionPriority?: number;
  overlay?: ReactNode;
  activation?: DragSortActivation;
  /** Opt in to a target-edge marker for future tree/drop-zone adapters. */
  showTargetIndicator?: boolean;
}

export interface DragSortItemBinding {
  id: DragSortId;
  disabled: boolean;
  itemRef: RefCallback<HTMLElement>;
  handleRef: RefCallback<HTMLElement>;
  targetRef: RefCallback<HTMLElement>;
  itemElement: HTMLElement | null;
  manager: ReturnType<typeof useDragSortContext>['manager'];
  rearmHoverReveal: () => void;
  itemProps: {
    'data-drag-sort-item': string;
    'data-drag-sort-id': string;
    'data-drag-sort-dragging': boolean | undefined;
    'data-drag-sort-target': boolean | undefined;
    'data-drag-sort-invalid': boolean | undefined;
    'data-drag-sort-placement': string | undefined;
    'data-drag-sort-axis': string;
    'data-drag-sort-has-overlay': boolean;
    'data-drag-sort-activation': string;
    'data-drag-sort-placeholder': boolean | undefined;
    'data-drag-sort-target-indicator': boolean | undefined;
    'data-drag-sort-hover-reveal-blocked': boolean | undefined;
  };
  itemState: ReturnType<ReturnType<typeof useDragSortContext>['manager']['getItemState']>;
}

export const DragSortItemContext = createContext<DragSortItemBinding | null>(null);

export function useDragSortItem(options: UseDragSortItemOptions): DragSortItemBinding {
  const { manager } = useDragSortContext();
  const [itemElement, setItemElement] = useState<HTMLElement | null>(null);
  const [handleElement, setHandleElement] = useState<HTMLElement | null>(null);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [hoverRevealBlocked, setHoverRevealBlocked] = useState(false);

  const itemRef = useCallback<RefCallback<HTMLElement>>((node) => setItemElement(node), []);
  const handleRef = useCallback<RefCallback<HTMLElement>>((node) => setHandleElement(node), []);
  const targetRef = useCallback<RefCallback<HTMLElement>>((node) => setTargetElement(node), []);

  // Registration is a lifecycle concern, not a render concern. In particular,
  // an overlay is commonly supplied as an inline React node, so its identity
  // can change while the item subscribes to drag updates. Re-registering on
  // that change briefly removes the active source and makes the overlay
  // disappear in the same frame the pointer crosses the activation threshold.
  // Keep the registration alive for the lifetime of this DOM node and patch
  // its mutable fields independently.
  useLayoutEffect(() => {
    if (!itemElement) return;
    const unregister = manager.registerItem({
      id: options.id,
      group: options.group,
      index: options.index,
      element: itemElement,
      handle: handleElement,
      activation: options.activation,
      target: targetElement ?? itemElement,
      label: options.label,
      type: options.type,
      acceptedTypes: options.acceptedTypes,
      disabled: options.disabled,
      hidden: options.hidden,
      targetDisabled: options.targetDisabled,
      collisionPriority: options.collisionPriority,
      overlay: options.overlay,
    });
    return unregister;
    // The item ID identifies this registration. Other fields are patched below
    // so a pointer update can never tear down an active operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemElement, manager, options.id]);

  useLayoutEffect(() => {
    if (!itemElement) return;
    manager.updateItem(options.id, {
      group: options.group,
      index: options.index,
      element: itemElement,
      handle: handleElement,
      activation: options.activation,
      target: targetElement ?? itemElement,
      label: options.label,
      type: options.type,
      acceptedTypes: options.acceptedTypes,
      disabled: options.disabled,
      hidden: options.hidden,
      targetDisabled: options.targetDisabled,
      collisionPriority: options.collisionPriority,
      overlay: options.overlay,
    });
  }, [
    options.acceptedTypes,
    options.activation,
    options.collisionPriority,
    options.disabled,
    options.group,
    handleElement,
    options.hidden,
    options.index,
    itemElement,
    options.label,
    manager,
    options.id,
    options.overlay,
    options.targetDisabled,
    targetElement,
    options.type,
  ]);

  useEffect(
    () =>
      manager.subscribePointerRelease((releasedId) => {
        if (Object.is(releasedId, options.id)) setHoverRevealBlocked(true);
      }),
    [manager, options.id]
  );

  const subscribe = useCallback(
    (listener: () => void) => manager.subscribe(listener, options.id),
    [manager, options.id]
  );
  const snapshot = useSyncExternalStore(subscribe, manager.getSnapshot, manager.getSnapshot);
  const itemState = manager.getItemState(options.id);
  const { isDragging, isTarget } = itemState;
  const hasOverlay =
    options.overlay !== undefined && options.overlay !== null && options.overlay !== false;
  const binding: DragSortItemBinding = {
    id: options.id,
    disabled: Boolean(options.disabled),
    itemRef,
    handleRef,
    targetRef,
    itemElement,
    manager,
    rearmHoverReveal: () => setHoverRevealBlocked(false),
    itemProps: {
      'data-drag-sort-item': 'true',
      'data-drag-sort-id': String(options.id),
      'data-drag-sort-dragging': isDragging || undefined,
      'data-drag-sort-target': isTarget || undefined,
      'data-drag-sort-invalid': isTarget && Boolean(snapshot.invalidReason) ? true : undefined,
      'data-drag-sort-placement': isTarget ? (itemState.placement ?? undefined) : undefined,
      'data-drag-sort-axis': itemState.axis,
      'data-drag-sort-has-overlay': hasOverlay,
      'data-drag-sort-activation': options.activation ?? 'handle',
      'data-drag-sort-placeholder': isDragging && hasOverlay ? true : undefined,
      'data-drag-sort-target-indicator': options.showTargetIndicator && isTarget ? true : undefined,
      'data-drag-sort-hover-reveal-blocked': hoverRevealBlocked || undefined,
    },
    itemState,
  };
  return binding;
}

export function useDragSortItemContext(): DragSortItemBinding {
  const value = useContext(DragSortItemContext);
  if (!value) throw new Error('useDragSortItemContext must be used inside a DragSortItem');
  return value;
}

/** Subscribe only this item's transform/target state to the manager store. */
export function useDragSortItemSnapshot(id: DragSortId) {
  const { manager } = useDragSortContext();
  const subscribe = useCallback(
    (listener: () => void) => manager.subscribe(listener, id),
    [id, manager]
  );
  useSyncExternalStore(subscribe, manager.getSnapshot, manager.getSnapshot);
  return manager.getItemState(id);
}
