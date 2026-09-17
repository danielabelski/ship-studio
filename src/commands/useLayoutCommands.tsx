/**
 * Arranging the workspace from the command palette.
 *
 * Everything the drag does, and the two things it cannot: making the current
 * arrangement the default, and giving a project back to it. Registered here
 * because the palette is the contract — a feature that is only reachable by
 * dragging a header is a feature most people never find.
 *
 * @module commands/useLayoutCommands
 */

import { ArrowDownIcon, ArrowUpIcon, PinIcon, SplitViewIcon } from '@/components/icons';
import { useCommands } from './useCommands';
import { useOptionalToast } from '../contexts/ToastContext';
import { usePanelDock } from '../contexts/PanelDockContext';
import {
  LAYOUT_PRESETS,
  PANEL_IDS,
  PANEL_META,
  findPanelPlacement,
  isDocked,
  sideOf,
  type PanelId,
  type WorkspaceLayout,
} from '../lib/workspaceLayout';

function stackTargetFor(
  layout: WorkspaceLayout,
  panel: PanelId
): { column: number; target: PanelId; index: number } | null {
  const columns = layout.columns;
  const index = columns.findIndex(
    (column) =>
      column.kind === 'panels' && column.panels.some((placement) => placement.panel === panel)
  );
  if (index < 0) return null;
  for (const neighbour of [index - 1, index + 1]) {
    const candidate = columns[neighbour];
    if (
      !candidate ||
      candidate.kind === 'preview' ||
      candidate.panels.length === 0 ||
      candidate.panels.some(({ panel: candidatePanel }) => layout.floating.includes(candidatePanel))
    )
      continue;
    const target =
      neighbour < index
        ? candidate.panels[candidate.panels.length - 1].panel
        : candidate.panels[0].panel;
    if (PANEL_IDS.includes(target)) {
      return {
        column: neighbour,
        target,
        index: neighbour < index ? candidate.panels.length : 0,
      };
    }
  }
  return null;
}

function canMoveWithinStack(layout: WorkspaceLayout, panel: PanelId, direction: -1 | 1): boolean {
  if (!isDocked(layout, panel)) return false;
  const location = findPanelPlacement(layout, panel);
  if (!location || location.column.panels.length < 2) return false;
  // A floating sibling is still remembered in the column, but it is not a
  // visible neighbour that the command can move past.
  if (location.column.panels.some(({ panel: sibling }) => !isDocked(layout, sibling))) {
    return false;
  }
  const targetIndex = location.panelIndex + direction;
  return targetIndex >= 0 && targetIndex < location.column.panels.length;
}

function canMoveToNewColumn(layout: WorkspaceLayout, panel: PanelId): boolean {
  if (!isDocked(layout, panel)) return false;
  const location = findPanelPlacement(layout, panel);
  // A singleton already occupies its own column; moving it to either adjacent
  // gap would be a no-op, so do not offer misleading commands.
  return Boolean(location && location.column.panels.length > 1);
}

export function useLayoutCommands(): void {
  const panelDock = usePanelDock();
  const {
    layout,
    layoutScope,
    setLayoutScope,
    isCustomised,
    differsFromDefault,
    nudge,
    setDocked,
    applyPreset,
    saveAsDefault,
    resetToDefault,
  } = panelDock;
  const { showToast } = useOptionalToast();

  useCommands(
    () => [
      ...PANEL_IDS.flatMap((panel) => {
        const label = PANEL_META[panel].label;
        const docked = isDocked(layout, panel);
        const commands = [
          {
            id: `layout.dock.${panel}`,
            title: docked ? `Float ${label} panel` : `Dock ${label} panel`,
            icon: <PinIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'panel', 'pin', 'dock', 'float', label.toLowerCase()],
            run: () => setDocked(panel, !docked),
          },
          {
            id: `layout.move.${panel}`,
            title: `Move ${label} panel ${sideOf(layout, panel) === 'left' ? 'right' : 'left'}`,
            icon: <SplitViewIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'arrange', 'reorder', 'move', label.toLowerCase()],
            // One step towards the preview, which is the move somebody reaching
            // for a command wants: it is what changes which side you are on.
            run: () => nudge(panel, sideOf(layout, panel) === 'left' ? 1 : -1),
          },
        ];
        const stackTarget = stackTargetFor(layout, panel);
        if (stackTarget) {
          const targetLabel = PANEL_META[stackTarget.target].label;
          commands.push({
            id: `layout.stack.${panel}`,
            title: `Stack ${label} with ${targetLabel}`,
            icon: <SplitViewIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'stack', 'panel', label.toLowerCase(), targetLabel.toLowerCase()],
            run: () => panelDock.stackPanel(panel, stackTarget.column, stackTarget.index),
          });
        }
        const location = findPanelPlacement(layout, panel);
        if (canMoveWithinStack(layout, panel, -1)) {
          commands.push({
            id: `layout.stack.up.${panel}`,
            title: `Move ${label} panel up`,
            icon: <ArrowUpIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'stack', 'panel', 'move', 'up', label.toLowerCase()],
            run: () => panelDock.movePanelWithinStack(panel, -1),
          });
        }
        if (canMoveWithinStack(layout, panel, 1)) {
          commands.push({
            id: `layout.stack.down.${panel}`,
            title: `Move ${label} panel down`,
            icon: <ArrowDownIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'stack', 'panel', 'move', 'down', label.toLowerCase()],
            run: () => panelDock.movePanelWithinStack(panel, 1),
          });
        }
        if (location && canMoveToNewColumn(layout, panel)) {
          commands.push({
            id: `layout.column.left.${panel}`,
            title: `Move ${label} panel to a new column left`,
            icon: <SplitViewIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'column', 'panel', 'move', 'new', 'left', label.toLowerCase()],
            run: () => panelDock.movePanelToColumnGap(panel, location.columnIndex),
          });
          commands.push({
            id: `layout.column.right.${panel}`,
            title: `Move ${label} panel to a new column right`,
            icon: <SplitViewIcon size={14} />,
            category: 'action' as const,
            when: 'project' as const,
            keywords: ['layout', 'column', 'panel', 'move', 'new', 'right', label.toLowerCase()],
            run: () => panelDock.movePanelToColumnGap(panel, location.columnIndex + 1),
          });
        }
        return commands;
      }),
      ...LAYOUT_PRESETS.map((preset) => ({
        id: `layout.preset.${preset.id}`,
        title: `Layout: ${preset.label}`,
        icon: <SplitViewIcon size={14} />,
        category: 'action' as const,
        when: 'project' as const,
        keywords: ['layout', 'preset', 'arrange', 'panels', preset.label.toLowerCase()],
        run: () => {
          applyPreset(preset);
          showToast(
            `${preset.label} layout applied ${layoutScope === 'global' ? 'across all projects' : 'to this project'}.`,
            'success'
          );
        },
      })),
      {
        id: 'layout.scope.project',
        title: 'Use a project-specific panel layout',
        icon: <SplitViewIcon size={14} />,
        category: 'action' as const,
        when: ({ kind }: { kind: string }) => kind === 'project' && layoutScope !== 'project',
        keywords: ['layout', 'scope', 'project', 'specific', 'panels'],
        run: () => setLayoutScope('project'),
      },
      {
        id: 'layout.scope.global',
        title: 'Use the same panel layout across all projects',
        icon: <SplitViewIcon size={14} />,
        category: 'action' as const,
        when: ({ kind }: { kind: string }) => kind === 'project' && layoutScope !== 'global',
        keywords: ['layout', 'scope', 'global', 'all', 'projects', 'panels'],
        run: () => setLayoutScope('global'),
      },
      {
        id: 'layout.saveDefault',
        title: 'Save this layout as my default',
        icon: <SplitViewIcon size={14} />,
        category: 'action' as const,
        when: ({ kind }: { kind: string }) =>
          kind === 'project' && layoutScope === 'project' && differsFromDefault,
        keywords: ['layout', 'default', 'save', 'panels', 'arrange'],
        run: () => {
          saveAsDefault();
          showToast('Saved. New projects will open like this.', 'success');
        },
      },
      {
        id: 'layout.reset',
        title: 'Reset panel layout',
        icon: <SplitViewIcon size={14} />,
        category: 'action' as const,
        when: ({ kind }: { kind: string }) =>
          kind === 'project' && layoutScope === 'project' && isCustomised,
        keywords: ['layout', 'reset', 'default', 'panels', 'arrange'],
        run: () => {
          resetToDefault();
          showToast('This project follows your default layout again.', 'success');
        },
      },
    ],
    [
      layout,
      layoutScope,
      isCustomised,
      differsFromDefault,
      nudge,
      setDocked,
      applyPreset,
      saveAsDefault,
      resetToDefault,
      setLayoutScope,
      panelDock.stackPanel,
      panelDock.movePanelWithinStack,
      panelDock.movePanelToColumnGap,
      showToast,
    ]
  );
}
