import { useEffect, useSyncExternalStore } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons';
import { useCommands } from './useCommands';
import type { PaletteCtx } from './types';
import {
  ensureFamilyRoot,
  familyRootOf,
  familyRootsVersion,
  subscribeFamilyRoots,
} from '../lib/worktreeFamilies';
import { basename } from '../lib/paths';
import { sessionRegistry } from '../lib/sessionRegistry';
import {
  getActiveProjectOrder,
  setActiveProjectOrder,
  subscribeActiveProjectOrder,
} from '../lib/activeProjectOrder';

interface Params {
  /** Confirmed pinned paths in the rail's persisted order. */
  pinnedPaths: readonly string[];
  /** The project currently open in the workspace, if any. */
  currentProjectPath: string | null;
  /** The same feature-owned mutation used by pointer and handle sorting. */
  onReorderProjects: (orderedPaths: string[]) => Promise<void> | void;
}

/**
 * Stable, null-rendering host for the pinned-project command contribution.
 *
 * Keeping this feature hook behind its own component prevents adding or
 * evolving command hooks from changing the hook sequence in AppContents,
 * which is especially important while React Fast Refresh is preserving the
 * app tree during development.
 */
export function PinnedProjectCommandHost(props: Params): null {
  usePinnedProjectCommands(props);
  return null;
}

/** Register palette moves for the currently open pinned project. */
export function usePinnedProjectCommands({
  pinnedPaths,
  currentProjectPath,
  onReorderProjects,
}: Params): void {
  const familyVersion = useSyncExternalStore(
    subscribeFamilyRoots,
    familyRootsVersion,
    familyRootsVersion
  );
  const activeOrder = useSyncExternalStore(
    subscribeActiveProjectOrder,
    getActiveProjectOrder,
    getActiveProjectOrder
  );
  const activeSessionsVersion = useSyncExternalStore(
    sessionRegistry.subscribeSimple,
    () =>
      sessionRegistry
        .snapshotAll()
        .map((session) => session.projectPath)
        .sort()
        .join('\n'),
    () => ''
  );

  useEffect(() => {
    if (currentProjectPath) ensureFamilyRoot(currentProjectPath);
  }, [currentProjectPath]);

  useCommands(() => {
    if (!currentProjectPath) return [];
    const currentFamily = familyRootOf(currentProjectPath);
    const currentIndex = pinnedPaths.indexOf(currentFamily);
    const pinnedMove = (delta: -1 | 1) => {
      const destination = currentIndex + delta;
      if (destination < 0 || destination >= pinnedPaths.length) return;
      const next = [...pinnedPaths];
      const [project] = next.splice(currentIndex, 1);
      if (project === undefined) return;
      next.splice(destination, 0, project);
      return Promise.resolve(onReorderProjects(next)).catch(() => undefined);
    };

    const pinnedCommands =
      currentIndex >= 0
        ? [
            {
              id: 'project.movePinnedUp',
              title: 'Move pinned project up',
              icon: <ArrowUpIcon size={14} />,
              category: 'project' as const,
              when: ({ kind }: PaletteCtx) => kind === 'project' && currentIndex > 0,
              keywords: ['project', 'pinned', 'move', 'up', 'reorder'],
              run: () => pinnedMove(-1),
            },
            {
              id: 'project.movePinnedDown',
              title: 'Move pinned project down',
              icon: <ArrowDownIcon size={14} />,
              category: 'project' as const,
              when: ({ kind }: PaletteCtx) =>
                kind === 'project' && currentIndex < pinnedPaths.length - 1,
              keywords: ['project', 'pinned', 'move', 'down', 'reorder'],
              run: () => pinnedMove(1),
            },
          ]
        : [];

    if (currentIndex >= 0) return pinnedCommands;

    const pinSet = new Set(pinnedPaths);
    const activePaths = new Set<string>();
    for (const session of sessionRegistry.snapshotAll()) {
      const family = familyRootOf(session.projectPath);
      if (!pinSet.has(family)) activePaths.add(family);
    }
    if (!activePaths.has(currentFamily)) return [];

    const activeOrdered = [...activePaths].sort((a, b) => {
      const aRank = activeOrder.indexOf(a);
      const bRank = activeOrder.indexOf(b);
      if (aRank >= 0 || bRank >= 0) {
        if (aRank < 0) return 1;
        if (bRank < 0) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return (basename(a) || a).localeCompare(basename(b) || b) || a.localeCompare(b);
    });
    const activeIndex = activeOrdered.indexOf(currentFamily);
    const moveActive = (delta: -1 | 1) => {
      const destination = activeIndex + delta;
      if (destination < 0 || destination >= activeOrdered.length) return;
      const next = [...activeOrdered];
      const [project] = next.splice(activeIndex, 1);
      if (project === undefined) return;
      next.splice(destination, 0, project);
      setActiveProjectOrder(next);
    };

    return [
      {
        id: 'project.moveActiveUp',
        title: 'Move active project up',
        icon: <ArrowUpIcon size={14} />,
        category: 'project' as const,
        when: ({ kind }: PaletteCtx) => kind === 'project' && activeIndex > 0,
        keywords: ['project', 'active', 'move', 'up', 'reorder'],
        run: () => moveActive(-1),
      },
      {
        id: 'project.moveActiveDown',
        title: 'Move active project down',
        icon: <ArrowDownIcon size={14} />,
        category: 'project' as const,
        when: ({ kind }: PaletteCtx) =>
          kind === 'project' && activeIndex >= 0 && activeIndex < activeOrdered.length - 1,
        keywords: ['project', 'active', 'move', 'down', 'reorder'],
        run: () => moveActive(1),
      },
    ];
  }, [
    currentProjectPath,
    onReorderProjects,
    pinnedPaths,
    familyVersion,
    activeOrder,
    activeSessionsVersion,
  ]);
}
