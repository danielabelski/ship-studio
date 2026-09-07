/**
 * The team, inside the project you are working in.
 *
 * The home-level Team screen answers "what is everyone up to". This one
 * answers the question you actually have while working: *what changed under
 * me, and does any of it affect what I am about to do.* Same data, scoped to
 * this repo, one keystroke away without leaving the workspace.
 *
 * Opens on **What's new** — the updates that landed since you last looked —
 * because that is the only tab with a time limit on its usefulness. It empties
 * itself as you read it, which is the behaviour that keeps people opening it.
 *
 * A floating `DockablePanel` for the same reason canvas comments is one: it
 * sits over the preview you are already looking at instead of taking a pane
 * away from it, and it can be moved out of the way without being closed.
 *
 * @module components/team/TeamPanel
 */

import { useMemo, useSyncExternalStore } from 'react';
import {
  CheckIcon,
  CloseIcon,
  CollaboratorsIcon,
  CommentIcon,
  HistoryIcon,
} from '@/components/icons';
import { DockablePanel } from '../primitives/DockablePanel';
import { EmptyState } from '../primitives/EmptyState';
import { IconButton } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { Tabs, TabsList, TabsTab } from '../primitives/Tabs';
import { TeamCoverageNote } from './TeamCoverageNote';
import { TeamPeoplePanel } from './TeamPeoplePanel';
import { TeamThreadsPanel } from './TeamThreadsPanel';
import { TeamUpdateCard } from './TeamUpdateCard';
import { groupByDay, openThreads } from '../../lib/team';
import {
  getSnapshot,
  getUiSnapshot,
  markAllSeen,
  setTeamTab,
  subscribe,
  toggleExpanded,
  unseenUpdates,
  type TeamTab,
} from '../../lib/teamStore';

interface TeamPanelProps {
  hidden: boolean;
  onClose: () => void;
  now: number;
}

export function TeamPanel({ hidden, onClose, now }: TeamPanelProps) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { tab, expandedId, loading } = useSyncExternalStore(subscribe, getUiSnapshot);

  const unseen = useMemo(() => unseenUpdates(snapshot), [snapshot]);
  const unseenIds = useMemo(() => new Set(unseen.map((update) => update.id)), [unseen]);
  const groups = useMemo(() => groupByDay(snapshot.updates, now), [snapshot.updates, now]);
  const unresolved = openThreads(snapshot.threads).length;

  return (
    <DockablePanel
      docked={false}
      visible={!hidden}
      ariaLabel="Team"
      positionKey="team.panel.position"
      sizeKey="team.panel.size"
      keepWithinViewport
      floatingSize={{ width: 420, height: Math.min(620, window.innerHeight - 140) }}
      minFloatingSize={{ width: 340, height: 320 }}
      initialPosition={() => ({ left: Math.max(16, window.innerWidth - 452), top: 96 })}
      surfaceClassName="team-panel-float"
    >
      {/* One wrapper child, deliberately. `.dockable-panel__surface > *` sets
          `height: 100%` on every direct child, so a header/tabs/body trio ends
          up as three full-height boxes sharing the panel by shrinkage — the
          header's content lands halfway down and the body has nowhere to go.
          Giving the surface a single child lets that rule do what it is for. */}
      <div className="team-float-inner">
        <header className="team-float-header" data-dockable-drag-handle>
          <span className="team-float-title">
            Team
            {unseen.length > 0 && <span className="team-float-count">{unseen.length} new</span>}
          </span>
          <div className="team-float-header-actions">
            {unseen.length > 0 && (
              <IconButton
                variant="ghost"
                size="compact"
                icon={<CheckIcon size={12} />}
                onClick={() => markAllSeen()}
                title="Mark everything as seen"
                aria-label="Mark everything as seen"
              />
            )}
            <IconButton
              variant="ghost"
              size="compact"
              icon={<CloseIcon size={12} />}
              onClick={onClose}
              title="Close"
              aria-label="Close"
            />
          </div>
        </header>

        <div className="team-float-tabs">
          <Tabs value={tab} onValueChange={(next) => setTeamTab(next as TeamTab)} mode="navigation">
            <TabsList aria-label="Team">
              <TabsTab value="updates" leftIcon={<HistoryIcon size={11} />}>
                What&rsquo;s new
              </TabsTab>
              <TabsTab value="people" leftIcon={<CollaboratorsIcon size={11} />}>
                People
              </TabsTab>
              <TabsTab value="comments" leftIcon={<CommentIcon size={11} />}>
                {unresolved > 0 ? `Comments (${unresolved})` : 'Comments'}
              </TabsTab>
            </TabsList>
          </Tabs>
        </div>

        <div className="team-float-body">
          {tab === 'updates' &&
            (snapshot.updates.length === 0 ? (
              loading ? (
                <EmptyState
                  icon={<Spinner size="lg" />}
                  title="Reading this repository"
                  description="Walking the history and asking GitHub about open pull requests."
                />
              ) : snapshot.sync.error ? (
                <EmptyState
                  icon={<HistoryIcon size={24} />}
                  title="Couldn't read the history"
                  description={snapshot.sync.error}
                />
              ) : (
                <EmptyState
                  icon={<HistoryIcon size={24} />}
                  title="Nothing yet"
                  description="When someone pushes work to this repository, what they did shows up here."
                />
              )
            ) : (
              groups.map((group) => (
                <section className="team-float-day" key={group.key}>
                  <h3 className="team-float-day-heading">{group.label}</h3>
                  {group.updates.map((update) => (
                    <TeamUpdateCard
                      key={update.id}
                      update={update}
                      expanded={expandedId === update.id}
                      onToggleExpanded={toggleExpanded}
                      isNew={unseenIds.has(update.id)}
                      now={now}
                    />
                  ))}
                </section>
              ))
            ))}

          {/* Sits at the foot of the feed, after the thing it is about, rather
              than at the top where it would be a banner in front of the work. */}
          {tab === 'updates' && snapshot.updates.length > 0 && (
            <TeamCoverageNote members={snapshot.members} repo={snapshot.sync.repo} />
          )}

          {tab === 'people' && <TeamPeoplePanel members={snapshot.members} now={now} compact />}

          {tab === 'comments' && (
            <TeamThreadsPanel threads={snapshot.threads} showProject={false} now={now} compact />
          )}
        </div>
      </div>
    </DockablePanel>
  );
}
