/**
 * Palette commands for Team.
 *
 * Registered even though this is a prototype, for the reason CLAUDE.md gives:
 * the UI harness sweeps the palette registry to screenshot every feature, so a
 * surface that does not register here is invisible to review.
 *
 * Each command lands on the surface it names rather than on the Team screen
 * with that surface one more click away — which is why the tab lives in
 * `teamStore` instead of in `TeamView`'s own state.
 *
 * @module commands/useTeamCommands
 */

import { useSyncExternalStore } from 'react';
import { CollaboratorsIcon, CommentIcon, HistoryIcon, InfoIcon } from '@/components/icons';
import { useCommands } from './useCommands';
import { openThreads } from '../lib/team';
import {
  getSnapshot,
  setHowItWorksOpen,
  setTeamTab,
  subscribe,
  type TeamTab,
} from '../lib/teamStore';
import type { AppView } from '../lib/types';

interface UseTeamCommandsParams {
  setView: (view: AppView) => void;
}

export function useTeamCommands({ setView }: UseTeamCommandsParams) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const unresolved = openThreads(snapshot.threads).length;

  const go = (tab: TeamTab, howItWorks = false) => {
    setTeamTab(tab);
    setHowItWorksOpen(howItWorks);
    setView('team');
  };

  useCommands(
    () => [
      {
        id: 'team.open',
        title: 'Team',
        icon: <CollaboratorsIcon size={14} />,
        category: 'navigation',
        keywords: ['collaborators', 'multiplayer', 'who', 'together', 'shared'],
        run: () => go('updates'),
      },
      {
        id: 'team.updates',
        title: 'What the team has been doing',
        icon: <HistoryIcon size={14} />,
        category: 'navigation',
        keywords: ['audit', 'history', 'feed', 'what happened', 'changes', 'log'],
        run: () => go('updates'),
      },
      {
        id: 'team.people',
        title: 'Who is working on what',
        icon: <CollaboratorsIcon size={14} />,
        category: 'navigation',
        keywords: ['people', 'presence', 'branches', 'collaborators', 'members'],
        run: () => go('people'),
      },
      {
        id: 'team.comments',
        title: unresolved > 0 ? `Team comments (${unresolved} open)` : 'Team comments',
        icon: <CommentIcon size={14} />,
        category: 'navigation',
        keywords: ['feedback', 'threads', 'replies', 'review', 'notes'],
        run: () => go('comments'),
      },
      {
        id: 'team.howItWorks',
        title: 'How team sync works',
        icon: <InfoIcon size={14} />,
        category: 'navigation',
        keywords: ['privacy', 'what gets committed', 'who can see', 'git', 'explain'],
        run: () => go('updates', true),
      },
    ],
    [setView, unresolved]
  );
}
