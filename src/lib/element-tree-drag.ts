import type { ElementTreeNode } from '../hooks/useElementTree';
import type { DragSortPlacement } from './drag-sort/types';

export interface ElementTreeRow {
  node: ElementTreeNode;
  depth: number;
  parentId: number | null;
  siblingIndex: number;
}

export interface ElementTreeProjection {
  rows: readonly ElementTreeRow[];
  order: readonly number[];
  changed: boolean;
}

type Expanded = (id: number, depth: number) => boolean;

const cloneTree = (node: ElementTreeNode): ElementTreeNode => ({
  ...node,
  children: node.children.map(cloneTree),
});

function flattenTree(
  root: ElementTreeNode,
  isExpanded: Expanded,
  visibleIds?: ReadonlySet<number>,
  forcedExpandedId?: number
): ElementTreeProjection {
  const rows: ElementTreeRow[] = [];
  const walk = (
    node: ElementTreeNode,
    depth: number,
    parentId: number | null,
    siblingIndex: number
  ) => {
    if (visibleIds?.has(node.id) ?? true) {
      rows.push({
        node,
        depth,
        parentId,
        siblingIndex,
      });
    }
    if (node.children.length > 0 && (node.id === forcedExpandedId || isExpanded(node.id, depth))) {
      node.children.forEach((child, index) => walk(child, depth + 1, node.id, index));
    }
  };
  walk(root, 0, null, 0);
  return { rows, order: rows.map((row) => row.node.id), changed: false };
}

function mapTree(root: ElementTreeNode) {
  const nodes = new Map<number, ElementTreeNode>();
  const parents = new Map<number, ElementTreeNode | null>();
  const walk = (node: ElementTreeNode, parent: ElementTreeNode | null) => {
    nodes.set(node.id, node);
    parents.set(node.id, parent);
    node.children.forEach((child) => walk(child, node));
  };
  walk(root, null);
  return { nodes, parents };
}

/**
 * Project a drag into the authored hierarchy without changing the source tree.
 * Before/after always mean sibling insertion; inside appends to the target's
 * children. The optional visible set keeps collapsed target children out of the
 * sortable order while still keeping the moved row visible during the drag.
 */
export function projectElementTree(
  root: ElementTreeNode,
  activeId: number,
  targetId: number,
  placement: DragSortPlacement,
  isExpanded: Expanded = () => true,
  visibleIds?: ReadonlySet<number>
): ElementTreeProjection {
  const source = flattenTree(root, isExpanded, visibleIds);
  const clone = cloneTree(root);
  const { nodes, parents } = mapTree(clone);
  const active = nodes.get(activeId);
  const target = nodes.get(targetId);
  const parent = active ? parents.get(activeId) : undefined;
  const targetParent = target ? parents.get(targetId) : undefined;

  // The document root has no sibling destination. Descendant targets are also
  // rejected here so every caller gets a safe, unchanged projection.
  if (!active || !target || !parent || activeId === targetId) return source;
  let cursor: ElementTreeNode | null | undefined = targetParent;
  while (cursor) {
    if (cursor.id === activeId) return source;
    cursor = parents.get(cursor.id);
  }

  const sourceIndex = parent.children.findIndex((child) => child.id === activeId);
  if (sourceIndex < 0) return source;
  parent.children.splice(sourceIndex, 1);

  let nextParent: ElementTreeNode;
  let nextIndex: number;
  if (placement === 'inside') {
    nextParent = target;
    nextIndex = target.children.length;
    target.children.push(active);
  } else {
    if (!targetParent) return source;
    const targetIndex = targetParent.children.findIndex((child) => child.id === targetId);
    if (targetIndex < 0) return source;
    nextParent = targetParent;
    nextIndex = targetIndex + (placement === 'after' ? 1 : 0);
    targetParent.children.splice(nextIndex, 0, active);
  }

  const projection = flattenTree(
    clone,
    isExpanded,
    visibleIds,
    placement === 'inside' ? targetId : undefined
  );
  return {
    ...projection,
    changed: parent.id !== nextParent.id || sourceIndex !== nextIndex,
  };
}

/** Flatten the currently visible hierarchy for rendering and registration. */
export function flattenElementTree(
  root: ElementTreeNode,
  isExpanded: Expanded = () => true
): ElementTreeProjection {
  return flattenTree(root, isExpanded);
}
