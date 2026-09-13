/**
 * Element tree panel — a Webflow-style navigator for the preview.
 *
 * Shows the rendered DOM as a collapsible tree; clicking a row selects the
 * element through the same path as clicking it on the canvas, so the visual
 * editor panel picks it up. Structural edits (insert / duplicate / delete /
 * cut / copy / paste)
 * live in the row context menu; each action selects its row first
 * (`selectAndRun`) so it operates on the element the user aimed at.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  CutIcon,
  ElementsIcon,
  DuplicateIcon,
  PinIcon,
  PasteIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons';
import { ElementHtmlEditor } from './ElementHtmlEditor';
import { InsertMenu } from './InsertMenu';
import { getElementIcon } from './element-icons';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useLocalStorageFlag } from '../../hooks/useLocalStorageFlag';
import { useOptionalToast } from '../../contexts/ToastContext';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../primitives/ContextMenu';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../primitives/Tabs';
import { IconButton } from '../primitives/IconButton';
import { ToggleButton } from '../primitives/ToggleButton';
import { Tooltip } from '../primitives/Tooltip';
import type { ElementTreeNode } from '../../hooks/useElementTree';
import type { ElementSignature } from '../../lib/edit';
import {
  STRUCTURAL_ELEMENTS,
  VOID_ELEMENTS,
  type ElementKind,
  type InsertPosition,
} from '../../lib/edit-structure';
import { kbd } from '../../lib/shortcuts';
import { DragSortItem, DragSortScope } from '../primitives/DragSort';
import { useDragSortContext } from '../../contexts/DragSortContext';
import type {
  DragSortMove,
  DragSortPlacement,
  DragSortPoint,
  DragSortTarget,
} from '../../lib/drag-sort/types';
import { useCommands } from '../../commands/useCommands';
import type { PaletteCtx } from '../../commands/types';

/** The structural-edit actions the panel's context menu drives
 *  (from `useElementStructure`). */
export interface TreeStructureActions {
  selectAndRun: (nodeId: number, action: () => void) => void;
  insert: (position: InsertPosition, kind: ElementKind) => void;
  move?: (
    sourceNodeId: number,
    targetNodeId: number,
    position: InsertPosition
  ) => void | Promise<void>;
  duplicate: () => void;
  remove: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  hasClipboard: boolean;
  clipboardSourceNodeId: number | null;
  busy?: boolean;
}

interface Props {
  tree: ElementTreeNode | null;
  truncated: boolean;
  selectedId: number | null;
  /** The element currently hovered in the preview, when edit mode is active. */
  hoveredId?: number | null;
  /** Same-source matches that will also change when the primary selection is edited. */
  affectedIds?: readonly number[];
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  /** The currently-selected element (for the Code/HTML view). */
  projectPath: string;
  selectedSignature: ElementSignature | null;
  /** Notified when the Visual/Code view toggles, so the parent can widen the
   *  panel for editing markup. */
  onViewChange?: (view: 'visual' | 'code') => void;
  /** When provided, rows get the structural-edit context menu. */
  structure?: TreeStructureActions;
  /** Ref to the panel shell, used by the parent resize control. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Whether the panel currently occupies its left-hand preview dock. */
  pinned?: boolean;
  /** Switch between the preview dock and a draggable floating panel. */
  onTogglePin?: () => void;
  /** Hide the panel without changing its docked/floating preference. */
  onClose?: () => void;
}

/** Rows at depth < this start expanded so the tree isn't a single chevron. */
const AUTO_EXPAND_DEPTH = 3;
const SHOW_TAG_ICONS_STORAGE_KEY = 'elementTreeShowTagIcons';

/** Map of node id → ancestor id chain, for auto-expanding to a selection. */
function buildAncestors(root: ElementTreeNode): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const walk = (node: ElementTreeNode, chain: number[]) => {
    out.set(node.id, chain);
    const next = [...chain, node.id];
    for (const child of node.children) walk(child, next);
  };
  walk(root, []);
  return out;
}

function findSiblings(
  root: ElementTreeNode,
  nodeId: number
): { siblings: ElementTreeNode[]; index: number } | null {
  const walk = (node: ElementTreeNode): { siblings: ElementTreeNode[]; index: number } | null => {
    const index = node.children.findIndex((child) => child.id === nodeId);
    if (index >= 0) return { siblings: [...node.children], index };
    for (const child of node.children) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  };
  return walk(root);
}

/** The CSS-selector-shaped string the tree row's own label is built from
 *  (tag + every class, dot-joined) — what "Copy selector" puts on the
 *  clipboard, so pasting it into a chat matches what was right-clicked. */
function elementSelector(tag: string, cls: string): string {
  const classes = cls.trim().split(/\s+/).filter(Boolean);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

function RowLabel({ node, showTagIcons }: { node: ElementTreeNode; showTagIcons: boolean }) {
  const firstClass = node.cls.split(/\s+/)[0] ?? '';
  const elementIcon = showTagIcons ? getElementIcon(node.tag) : undefined;
  return (
    <>
      {elementIcon ? (
        <span className="ss-tree-tag-icon" title={`<${node.tag}>`}>
          {elementIcon}
        </span>
      ) : (
        <span className="ss-tree-tag">{node.tag}</span>
      )}
      {firstClass && <span className="ss-tree-class">.{firstClass}</span>}
      {node.text && <span className="ss-tree-text">{node.text}</span>}
    </>
  );
}

function selectorForNode(node: ElementTreeNode): string {
  return `${node.tag}${node.cls
    .split(/\s+/)
    .filter(Boolean)
    .map((className) => `.${className}`)
    .join('')}`;
}

function TreeDragOverlay({ node, depth }: { node: ElementTreeNode; depth: number }) {
  return (
    <div
      className="ss-tree-row ss-tree-row--overlay"
      style={{ paddingLeft: depth * 14 + 6 }}
      data-drag-sort-overlay-content="true"
    >
      <span className="ss-tree-chevron-spacer" />
      <RowLabel node={node} showTagIcons={false} />
    </div>
  );
}

function treeNodeById(root: ElementTreeNode | null, id: number): ElementTreeNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = treeNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export function treePlacementForTarget(
  target: DragSortTarget,
  point: DragSortPoint,
  axis: 'vertical' | 'horizontal'
): DragSortPlacement {
  const coordinate = axis === 'horizontal' ? point.x : point.y;
  const start = axis === 'horizontal' ? target.rect.left : target.rect.top;
  const size = axis === 'horizontal' ? target.rect.width : target.rect.height;
  const ratio = size > 0 ? (coordinate - start) / size : 0.5;
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

export function projectTreeVisibleOrder(
  order: readonly (string | number)[],
  activeId: string | number,
  targetId: string | number,
  placement: DragSortPlacement,
  movingIds: ReadonlySet<string>
): readonly (string | number)[] {
  const key = (id: string | number) => `${typeof id}:${String(id)}`;
  const activeIndex = order.findIndex((id) => key(id) === key(activeId));
  const targetIndex = order.findIndex((id) => key(id) === key(targetId));
  if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return [...order];
  const moving = order.filter((id) => movingIds.has(key(id)));
  const next = order.filter((id) => !movingIds.has(key(id)));
  const targetAfterRemoval = next.findIndex((id) => key(id) === key(targetId));
  const insertion =
    targetAfterRemoval + (placement === 'after' ? 1 : placement === 'inside' ? 1 : 0);
  next.splice(Math.max(0, Math.min(insertion, next.length)), 0, ...moving);
  return next;
}

function TreeDragLifecycle({
  root,
  isCollapsed,
  onExpand,
  children,
}: {
  root: ElementTreeNode | null;
  isCollapsed: (id: number) => boolean;
  onExpand: (id: number) => void;
  children: ReactNode;
}) {
  const { manager } = useDragSortContext();
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );
  useEffect(() => {
    if (
      snapshot.phase !== 'dragging' ||
      snapshot.invalidReason ||
      snapshot.targetId === null ||
      snapshot.placement !== 'inside'
    ) {
      return;
    }
    const targetId = Number(snapshot.targetId);
    const target = treeNodeById(root, targetId);
    if (!target?.children.length || !isCollapsed(targetId)) return;
    const timer = window.setTimeout(() => {
      onExpand(targetId);
      window.requestAnimationFrame(() => manager.remeasure());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    isCollapsed,
    onExpand,
    root,
    snapshot.invalidReason,
    snapshot.phase,
    snapshot.placement,
    snapshot.targetId,
  ]);
  return <>{children}</>;
}

export function ElementTreePanel({
  tree,
  truncated,
  selectedId,
  hoveredId = null,
  affectedIds = [],
  onSelect,
  onHover,
  projectPath,
  selectedSignature,
  onViewChange,
  structure,
  panelRef,
  pinned = true,
  onTogglePin,
  onClose,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [showTagIcons, , toggleShowTagIcons] = useLocalStorageFlag(
    SHOW_TAG_ICONS_STORAGE_KEY,
    false
  );
  // The insert palette is anchored to the most recent context-menu gesture.
  // The primitive owns menu state; this ref only bridges the menu item to the
  // existing InsertMenu, which opens after the context menu closes.
  const contextTargetRef = useRef<{
    nodeId: number;
    tag: string;
    cls: string;
    x: number;
    y: number;
  } | null>(null);
  const { showToast } = useOptionalToast();
  const { copy: copySelector } = useCopyToClipboard({
    onCopy: () => showToast('Selector copied', 'success'),
    onError: () => showToast('Could not copy the selector', 'error'),
  });
  const [insertFor, setInsertFor] = useState<{
    nodeId: number;
    tag: string;
    anchor: { left: number; top: number; bottom: number };
  } | null>(null);
  const notifyCopy = useCallback(
    () => showToast('Element id copied — paste it to your agent', 'success'),
    [showToast]
  );
  const { copy: copyElementId, isCopied: elementIdCopied } = useCopyToClipboard({
    onCopy: notifyCopy,
  });
  const selectView = (next: 'visual' | 'code') => {
    setView(next);
    onViewChange?.(next);
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  const visibleView = structure ? view : 'visual';
  const affectedSet = useMemo(() => new Set(affectedIds), [affectedIds]);

  const ancestors = useMemo(() => (tree ? buildAncestors(tree) : null), [tree]);
  useCommands(() => {
    if (!structure || !tree || selectedId === null || !structure.move) return [];
    const siblingState = findSiblings(tree, selectedId);
    if (!siblingState) return [];
    const { siblings, index } = siblingState;
    const move = (destination: ElementTreeNode, position: InsertPosition) =>
      structure.move?.(selectedId, destination.id, position);
    return [
      {
        id: 'element.moveSelectedUp',
        title: 'Move selected element up',
        category: 'project' as const,
        keywords: ['element', 'move', 'up', 'reorder'],
        when: ({ kind }: PaletteCtx) => kind === 'project' && index > 0,
        run: () => {
          const destination = siblings[index - 1];
          if (destination) move(destination, 'before');
        },
      },
      {
        id: 'element.moveSelectedDown',
        title: 'Move selected element down',
        category: 'project' as const,
        keywords: ['element', 'move', 'down', 'reorder'],
        when: ({ kind }: PaletteCtx) =>
          kind === 'project' && index >= 0 && index < siblings.length - 1,
        run: () => {
          const destination = siblings[index + 1];
          if (destination) move(destination, 'after');
        },
      },
    ];
  }, [selectedId, structure, tree]);
  const handleTreeMove = useCallback(
    (move: DragSortMove) => {
      const target = move.targetId;
      if (target === undefined) return;
      if (target === move.activeId) return;
      return structure?.move?.(
        Number(move.activeId),
        Number(target),
        (move.to.placement ?? 'after') as InsertPosition
      );
    },
    [structure]
  );

  // Selecting on the canvas should reveal the row: expand its ancestor chain
  // (presence in `collapsed` is depth-inverted — see collapsedState). Done as
  // a render-time state adjustment (the sanctioned "derive from prop change"
  // pattern) rather than an effect, so there's no cascading re-render.
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  if (selectedId !== revealedFor) {
    setRevealedFor(selectedId);
    const chain = selectedId != null ? ancestors?.get(selectedId) : undefined;
    if (chain) {
      let changed = false;
      const next = new Set(collapsed);
      chain.forEach((id, depth) => {
        const wantPresence = depth >= AUTO_EXPAND_DEPTH; // presence = expanded there
        if (wantPresence && !next.has(id)) {
          next.add(id);
          changed = true;
        } else if (!wantPresence && next.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      if (changed) setCollapsed(next);
    }
  }

  // Scroll the selected row into view once it exists in the DOM.
  useEffect(() => {
    if (selectedId == null) return;
    const raf = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector(`[data-tree-id="${selectedId}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  const toggle = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Presence in `collapsed` flips the depth-based default: shallow nodes
  // default open (presence = collapsed), deep nodes default closed
  // (presence = expanded).
  const collapsedState = (id: number, depth: number) =>
    depth < AUTO_EXPAND_DEPTH ? collapsed.has(id) : !collapsed.has(id);

  const visibleOrder = useMemo(() => {
    const ids: number[] = [];
    const walk = (node: ElementTreeNode, depth: number) => {
      ids.push(node.id);
      if (node.children.length > 0 && !collapsedState(node.id, depth)) {
        node.children.forEach((child) => walk(child, depth + 1));
      }
    };
    if (tree) walk(tree, 0);
    return ids;
  }, [collapsed, tree]);
  const visibleIndex = useMemo(
    () => new Map(visibleOrder.map((id, index) => [id, index])),
    [visibleOrder]
  );
  const nodeById = useMemo(() => {
    const out = new Map<number, ElementTreeNode>();
    const walk = (node: ElementTreeNode) => {
      out.set(node.id, node);
      node.children.forEach(walk);
    };
    if (tree) walk(tree);
    return out;
  }, [tree]);
  const projectTreeOrder = useCallback(
    (
      order: readonly (string | number)[],
      activeId: string | number,
      targetId: string | number,
      placement: DragSortPlacement
    ) => {
      const movingIds = new Set<string>();
      const activeNode = nodeById.get(Number(activeId));
      const key = (id: string | number) => `${typeof id}:${String(id)}`;
      const collect = (node: ElementTreeNode) => {
        movingIds.add(key(node.id));
        node.children.forEach(collect);
      };
      if (activeNode) collect(activeNode);
      return projectTreeVisibleOrder(order, activeId, targetId, placement, movingIds);
    },
    [nodeById]
  );
  const canTreeMove = useCallback(
    (
      destination: { index: number; group: string | number; placement?: InsertPosition },
      context: { active: { id: string | number }; target?: { id: string | number } }
    ) => {
      const targetId = Number(context.target?.id);
      const activeId = Number(context.active.id);
      const target = nodeById.get(targetId);
      if (!target || targetId === activeId)
        return { allowed: false, reason: 'Choose another element.' };
      const activeNode = nodeById.get(activeId);
      if (!activeNode || STRUCTURAL_ELEMENTS.has(activeNode.tag)) {
        return { allowed: false, reason: `<${activeNode?.tag ?? 'element'}> cannot be moved.` };
      }
      if (ancestors?.get(targetId)?.includes(activeId)) {
        return { allowed: false, reason: 'An element cannot be moved into its own descendant.' };
      }
      if (destination.placement === 'inside' && VOID_ELEMENTS.has(target.tag)) {
        return { allowed: false, reason: `<${target.tag}> cannot contain children.` };
      }
      if (destination.placement !== 'inside' && STRUCTURAL_ELEMENTS.has(target.tag)) {
        return { allowed: false, reason: `Nothing can be placed beside <${target.tag}>.` };
      }
      if (structure?.busy)
        return { allowed: false, reason: 'Another element move is in progress.' };
      return { allowed: true as const };
    },
    [ancestors, nodeById, structure?.busy]
  );

  const renderNode = (node: ElementTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isSelected = node.id === selectedId;
    const isHovered = node.id === hoveredId;
    const isAffected = !isSelected && affectedSet.has(node.id);
    // Collapsed = explicitly collapsed, or deep and never explicitly expanded.
    // The `collapsed` set tracks explicit toggles both ways via presence.
    const isCollapsed = hasChildren && collapsedState(node.id, depth);
    const clipboardSourceNodeId = structure?.clipboardSourceNodeId;
    const pasteDisabled =
      !structure?.hasClipboard ||
      VOID_ELEMENTS.has(node.tag) ||
      clipboardSourceNodeId === node.id ||
      (clipboardSourceNodeId != null && ancestors?.get(node.id)?.includes(clipboardSourceNodeId));
    const rowClassName = `ss-tree-row${isSelected ? ' selected' : ''}${
      isHovered ? ' hovered' : ''
    }${isAffected ? ' affected' : ''}`;
    const renderedNode = (
      <div key={node.id} className="ss-tree-node">
        {structure ? (
          <ContextMenu>
            <ContextMenuTrigger
              asChild
              onContextMenu={(e) => {
                onSelect(node.id); // select first, so the canvas shows the target
                contextTargetRef.current = {
                  nodeId: node.id,
                  tag: node.tag,
                  cls: node.cls,
                  x: e.clientX,
                  y: e.clientY,
                };
              }}
            >
              <div
                className={rowClassName}
                style={{ paddingLeft: depth * 14 + 6 }}
                data-tree-id={node.id}
                onClick={() => onSelect(node.id)}
                onMouseEnter={() => onHover(node.id)}
                onMouseLeave={() => onHover(null)}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={`ss-tree-chevron${isCollapsed ? '' : ' open'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(node.id);
                    }}
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    <ChevronRightIcon size={10} />
                  </button>
                ) : (
                  <span className="ss-tree-chevron-spacer" />
                )}
                <RowLabel node={node} showTagIcons={showTagIcons} />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label={`Actions for ${node.tag}`}>
              <ContextMenuItem
                onSelect={() => {
                  const target = contextTargetRef.current;
                  if (!target || target.nodeId !== node.id) return;
                  setInsertFor({
                    nodeId: node.id,
                    tag: node.tag,
                    anchor: { left: target.x, top: target.y, bottom: target.y },
                  });
                }}
              >
                <PlusIcon size={12} />
                <span>Insert element…</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void copyElementId(selectorForNode(node));
                }}
              >
                {elementIdCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                <span>{elementIdCopied ? 'Copied' : 'Copy ID'}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void copySelector(elementSelector(node.tag, node.cls));
                }}
              >
                <CopyIcon size={12} />
                <span>Copy selector</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => structure.selectAndRun(node.id, structure.duplicate)}
              >
                <DuplicateIcon size={12} />
                <span>Duplicate</span>
                <ContextMenuShortcut>{kbd('mod', 'D')}</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => structure.selectAndRun(node.id, structure.cut)}>
                <CutIcon size={12} />
                <span>Cut</span>
                <ContextMenuShortcut>{kbd('mod', 'X')}</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => structure.selectAndRun(node.id, structure.copy)}>
                <CopyIcon size={12} />
                <span>Copy</span>
                <ContextMenuShortcut>{kbd('mod', 'C')}</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                disabled={pasteDisabled}
                onSelect={() => structure.selectAndRun(node.id, structure.paste)}
              >
                <PasteIcon size={12} />
                <span>Paste</span>
                <ContextMenuShortcut>{kbd('mod', 'V')}</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => structure.selectAndRun(node.id, structure.remove)}
              >
                <TrashIcon size={12} />
                <span>Delete</span>
                <ContextMenuShortcut>{kbd('⌫')}</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <div
            className={rowClassName}
            style={{ paddingLeft: depth * 14 + 6 }}
            data-tree-id={node.id}
            onClick={() => onSelect(node.id)}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
          >
            {hasChildren ? (
              <button
                type="button"
                className={`ss-tree-chevron${isCollapsed ? '' : ' open'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <ChevronRightIcon size={10} />
              </button>
            ) : (
              <span className="ss-tree-chevron-spacer" />
            )}
            <RowLabel node={node} showTagIcons={showTagIcons} />
          </div>
        )}
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
    if (!structure) return renderedNode;
    return (
      <DragSortItem
        key={node.id}
        id={node.id}
        group="elements"
        index={visibleIndex.get(node.id) ?? 0}
        label={`Move ${node.tag} element`}
        activation="item"
        disabled={STRUCTURAL_ELEMENTS.has(node.tag)}
        collisionPriority={depth}
        showTargetIndicator
        style={{ '--drag-sort-tree-depth': depth } as CSSProperties}
        overlay={<TreeDragOverlay node={node} depth={depth} />}
      >
        {renderedNode}
      </DragSortItem>
    );
  };

  const sigKey = selectedSignature
    ? `${selectedSignature.tagName}|${selectedSignature.className}|${(selectedSignature.text ?? '').slice(0, 60)}`
    : '';

  return (
    <div
      ref={panelRef}
      className={`ss-tree-panel${structure ? '' : ' ss-tree-panel--view-only'}`}
      data-testid="element-tree-panel"
    >
      {structure ? (
        <Tabs value={visibleView} onValueChange={(next) => selectView(next as 'visual' | 'code')}>
          <div className="ss-tree-panel__header" data-dockable-drag-handle>
            <span className="ss-tree-panel__title">Elements</span>
            <TabsList className="ss-tree-panel__modes" aria-label="Elements view">
              <TabsTab value="visual">Visual</TabsTab>
              <TabsTab value="code">Code</TabsTab>
            </TabsList>
            {onTogglePin && (
              <ToggleButton
                variant="ghost"
                size="compact"
                className="button--icon-only panel-pin-toggle"
                onClick={onTogglePin}
                title={pinned ? 'Unpin — float over the workspace' : 'Pin to the window'}
                aria-label={pinned ? 'Unpin Elements panel' : 'Pin Elements panel to the window'}
                pressed={pinned}
                leftIcon={<PinIcon size={13} />}
              />
            )}
            {onClose && (
              <IconButton
                variant="ghost"
                size="compact"
                onClick={onClose}
                title="Close Elements panel"
                aria-label="Close Elements panel"
                icon={<CloseIcon size={14} />}
              />
            )}
          </div>
          <TabsPanel value={visibleView} className="ss-tree-panel__active-view">
            {visibleView === 'visual' ? (
              <div className="ss-tree-panel__body" ref={bodyRef} onMouseLeave={() => onHover(null)}>
                {tree ? (
                  <DragSortScope
                    label="Elements"
                    collision="containment"
                    canMove={canTreeMove}
                    onMove={handleTreeMove}
                    placementForTarget={treePlacementForTarget}
                    projectOrder={projectTreeOrder}
                    isPartOfActiveMove={(activeId, itemId) =>
                      ancestors?.get(Number(itemId))?.includes(Number(activeId)) ?? false
                    }
                  >
                    <TreeDragLifecycle
                      root={tree}
                      isCollapsed={(id) => {
                        const node = nodeById.get(id);
                        const depth = ancestors?.get(id)?.length ?? 0;
                        return Boolean(node?.children.length && collapsedState(id, depth));
                      }}
                      onExpand={(id) =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          const depth = ancestors?.get(id)?.length ?? 0;
                          if (depth < AUTO_EXPAND_DEPTH) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    >
                      {renderNode(tree, 0)}
                    </TreeDragLifecycle>
                  </DragSortScope>
                ) : (
                  <div className="ss-tree-panel__empty">Loading elements…</div>
                )}
                {truncated && (
                  <div className="ss-tree-panel__note">
                    Large page — showing the first part of the tree.
                  </div>
                )}
              </div>
            ) : (
              <div className="ss-tree-panel__body ss-tree-panel__body--code">
                {selectedSignature ? (
                  <ElementHtmlEditor
                    key={sigKey}
                    projectPath={projectPath}
                    signature={selectedSignature}
                  />
                ) : (
                  <div className="ss-tree-panel__empty">Select an element to edit its HTML.</div>
                )}
              </div>
            )}
          </TabsPanel>
          <TabsPanel
            value={visibleView === 'visual' ? 'code' : 'visual'}
            className="ss-tree-panel__active-view"
          />
        </Tabs>
      ) : (
        <>
          <div className="ss-tree-panel__header" data-dockable-drag-handle>
            <span className="ss-tree-panel__title">Elements</span>
            <Tooltip content="Turn on edit mode to select and edit elements.">
              <span className="ss-tree-panel__view-only">View only</span>
            </Tooltip>
            {onTogglePin && (
              <ToggleButton
                variant="ghost"
                size="compact"
                className="button--icon-only panel-pin-toggle"
                onClick={onTogglePin}
                title={pinned ? 'Unpin — float over the workspace' : 'Pin to the window'}
                aria-label={pinned ? 'Unpin Elements panel' : 'Pin Elements panel to the window'}
                pressed={pinned}
                leftIcon={<PinIcon size={13} />}
              />
            )}
            {onClose && (
              <IconButton
                variant="ghost"
                size="compact"
                onClick={onClose}
                title="Close Elements panel"
                aria-label="Close Elements panel"
                icon={<CloseIcon size={14} />}
              />
            )}
          </div>
          <div className="ss-tree-panel__body" ref={bodyRef} onMouseLeave={() => onHover(null)}>
            {tree ? (
              renderNode(tree, 0)
            ) : (
              <div className="ss-tree-panel__empty">Loading elements…</div>
            )}
            {truncated && (
              <div className="ss-tree-panel__note">
                Large page — showing the first part of the tree.
              </div>
            )}
          </div>
        </>
      )}
      <div className="ss-tree-panel__footer">
        <ToggleButton
          variant="ghost"
          size="compact"
          className="button--icon-only ss-tree-panel__tag-toggle"
          onClick={toggleShowTagIcons}
          title={showTagIcons ? 'Show tag names' : 'Show tag icons'}
          aria-label={showTagIcons ? 'Show tag names' : 'Show tag icons'}
          pressed={showTagIcons}
          leftIcon={<ElementsIcon size={14} />}
        />
      </div>
      {structure && (
        <>
          <InsertMenu
            anchor={insertFor?.anchor ?? null}
            insideDisabled={insertFor ? VOID_ELEMENTS.has(insertFor.tag) : false}
            outsideDisabled={insertFor ? STRUCTURAL_ELEMENTS.has(insertFor.tag) : false}
            onInsert={(position, kind) => {
              if (!insertFor) return;
              structure.selectAndRun(insertFor.nodeId, () => structure.insert(position, kind));
            }}
            onClose={() => setInsertFor(null)}
          />
        </>
      )}
    </div>
  );
}
