/* eslint-disable react-hooks/refs -- callback refs and manager bindings are intentionally rendered by this primitive. */

import {
  forwardRef,
  useCallback,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DragHandleIcon } from '@/components/icons';
import { useDragSortContext } from '../../contexts/DragSortContext';
import {
  DragSortItemContext,
  useDragSortItem,
  useDragSortItemContext,
  type UseDragSortItemOptions,
} from '../../hooks/useDragSortItem';

export interface DragSortItemProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'onDrag'>,
    Omit<UseDragSortItemOptions, 'overlay'> {
  children: ReactNode;
  /** Explicit content for the body-portaled overlay. */
  overlay?: ReactNode;
}

function mergeStyle(style: CSSProperties | undefined, transform: { x: number; y: number }) {
  const custom = style as (CSSProperties & { '--drag-sort-transform'?: string }) | undefined;
  return {
    ...style,
    '--drag-sort-transform': `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transform: 'var(--drag-sort-transform)',
    ...(custom?.transform && { transform: custom.transform }),
  } as CSSProperties;
}

export function DragSortItem({
  id,
  group,
  index,
  label,
  type,
  acceptedTypes,
  activation = 'handle',
  disabled = false,
  hidden = false,
  targetDisabled = false,
  collisionPriority,
  showTargetIndicator = false,
  overlay,
  className,
  style,
  children,
  onClick,
  onClickCapture,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onKeyDown,
  onPointerUp,
  ...rest
}: DragSortItemProps) {
  const binding = useDragSortItem({
    id,
    group,
    index,
    label,
    type,
    acceptedTypes,
    activation,
    disabled,
    hidden,
    targetDisabled,
    collisionPriority,
    showTargetIndicator,
    overlay,
  });
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerDown?.(event);
      // Nested sortables (tree rows) own their descendant gesture. Letting the
      // bubbling event reach an ancestor starts two operations and makes the
      // collision target depend on DOM nesting rather than the grabbed row.
      const nearestItem = (event.target as Element | null)?.closest?.('[data-drag-sort-item]');
      if (nearestItem && nearestItem !== event.currentTarget) return;
      const registeredHandle = binding.manager.getItem(id)?.handle;
      const fromRegisteredHandle =
        registeredHandle && event.target instanceof Node && registeredHandle.contains(event.target);
      if (!event.defaultPrevented && !fromRegisteredHandle) {
        binding.manager.pointerDown(id, event.nativeEvent, event.currentTarget);
      }
    },
    [binding.manager, id, onPointerDown]
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      const registeredHandle = binding.manager.getItem(id)?.handle;
      const fromRegisteredHandle =
        registeredHandle && event.target instanceof Node && registeredHandle.contains(event.target);
      if (!event.defaultPrevented && !fromRegisteredHandle) {
        binding.manager.keyDown(id, event.nativeEvent);
      }
    },
    [binding.manager, id, onKeyDown]
  );
  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (binding.manager.consumeClick(id)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClickCapture?.(event);
    },
    [binding.manager, id, onClickCapture]
  );
  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      binding.rearmHoverReveal();
      onPointerEnter?.(event);
    },
    [binding.rearmHoverReveal, onPointerEnter]
  );
  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(event);
    },
    [onPointerLeave]
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerUp?.(event);
    },
    [onPointerUp]
  );
  const classes = [
    'drag-sort__item',
    disabled ? 'is-disabled' : null,
    binding.itemState.isDragging ? 'is-dragging' : null,
    binding.itemState.isTarget ? 'is-target' : null,
    binding.itemState.isTarget && binding.itemProps['data-drag-sort-invalid']
      ? 'is-invalid-target'
      : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={binding.itemRef}
      className={classes}
      style={mergeStyle(style, binding.itemState.transform)}
      {...binding.itemProps}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onClickCapture={handleClickCapture}
      onClick={onClick}
      {...rest}
    >
      <DragSortItemContext.Provider value={binding}>{children}</DragSortItemContext.Provider>
    </div>
  );
}

export interface DragSortHandleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  /** Override the default move label when a feature has a more specific copy. */
  describedBy?: string;
  /** Keep the handle mounted, but reveal it when the row is hovered or keyboard-focused. */
  visibility?: 'always' | 'hover';
  /** For grouped rows, reveal from the immediate row instead of the whole item. */
  revealOn?: 'item' | 'row';
}

export const DragSortHandle = forwardRef<HTMLButtonElement, DragSortHandleProps>(
  function DragSortHandle(
    {
      label,
      describedBy,
      visibility = 'always',
      revealOn = 'item',
      className,
      children,
      onPointerDown,
      onKeyDown,
      ...rest
    },
    ref
  ) {
    const item = useDragSortItemContext();
    const { instructionsId, manager } = useDragSortContext();
    const onPointer = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented)
          manager.pointerDown(item.id, event.nativeEvent, item.itemElement ?? event.currentTarget);
      },
      [item.id, item.itemElement, manager, onPointerDown]
    );
    const onKey = useCallback(
      (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) manager.keyDown(item.id, event.nativeEvent);
      },
      [item.id, manager, onKeyDown]
    );
    const accessibleLabel = label ?? `Move ${manager.getItem(item.id)?.label ?? String(item.id)}`;
    return (
      <button
        {...rest}
        ref={(node) => {
          item.handleRef(node);
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        className={['drag-sort__handle', className].filter(Boolean).join(' ')}
        data-drag-sort-handle-visibility={visibility === 'hover' ? 'hover' : undefined}
        data-drag-sort-handle-reveal-on={visibility === 'hover' ? revealOn : undefined}
        aria-label={accessibleLabel}
        aria-describedby={describedBy ?? instructionsId}
        disabled={rest.disabled ?? item.disabled}
        onPointerDown={onPointer}
        onKeyDown={onKey}
      >
        {children ?? <DragHandleIcon size={14} aria-hidden="true" />}
      </button>
    );
  }
);

export { DragSortScope } from '../../contexts/DragSortContext';
export type { DragSortScopeProps } from '../../contexts/DragSortContext';
