/**
 * Team — the home-level screen for everything multiplayer.
 *
 * VISION PROTOTYPE. Data comes from `teamFixtures`; nothing here reaches a
 * backend. The point is to look at the shape of the feature before deciding to
 * build it.
 *
 * Placed beside Home, Workflows and Inbox because it is the same kind of
 * destination: a standing view over every project rather than something inside
 * one. Three tabs, each answering a different question a team actually asks —
 *
 *   Activity  what happened while I was away
 *   People    who is working on what right now
 *   Comments  what is waiting on me
 *
 * There is no setup step and no "enable multiplayer" switch. If the project
 * has a GitHub remote, the people who can see this are the people who can see
 * the repository, and that is the entire permission model. What replaces
 * onboarding is disclosure: one panel, one click away, saying plainly what
 * gets written into the repo and who can read it.
 *
 * @module components/team/TeamView
 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  ChevronIcon,
  CollaboratorsIcon,
  CommentIcon,
  GitHubIcon,
  HistoryIcon,
  InfoIcon,
  PullIcon,
} from '@/components/icons';
import { Button } from '../primitives/Button';
import { Dropdown, DropdownItem } from '../primitives/Dropdown';
import { MenuButton } from '../primitives/MenuButton';
import { Tabs, TabsList, TabsTab, TabsPanel } from '../primitives/Tabs';
import { DashboardHeader } from '../dashboard/DashboardHeader';
import { TeamActivityFeed } from './TeamActivityFeed';
import { TeamHowItWorks } from './TeamHowItWorks';
import { TeamPeoplePanel } from './TeamPeoplePanel';
import { TeamThreadsPanel } from './TeamThreadsPanel';
import { useDashboardVisibility } from '../../hooks/useDashboardVisibility';
import { formatAgo } from '../../lib/workflows';
import { openThreads } from '../../lib/team';
import {
  getSnapshot,
  getUiSnapshot,
  setHowItWorksOpen,
  setTeamTab,
  subscribe,
  sync,
} from '../../lib/teamStore';
import type { TeamTab } from '../../lib/teamStore';

export function TeamView() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { tab, howItWorksOpen } = useSyncExternalStore(subscribe, getUiSnapshot);
  const { dashboardHeaderHidden, hideDashboardHeader } = useDashboardVisibility();

  const [project, setProject] = useState<string | null>(null);

  /**
   * One clock for the whole screen.
   *
   * Every row shows a relative age, and calling `Date.now()` per row would let
   * two rows written in the same second disagree about what "now" is. It is
   * also the purity rule the lint enforces in render.
   */
  const [now] = useState(() => Date.now());

  const projects = useMemo(
    () => [...new Set(snapshot.events.map((event) => event.projectName))].sort(),
    [snapshot.events]
  );

  const events = useMemo(
    () =>
      project === null
        ? snapshot.events
        : snapshot.events.filter((event) => event.projectName === project),
    [snapshot.events, project]
  );

  const threads = useMemo(
    () =>
      project === null
        ? snapshot.threads
        : snapshot.threads.filter((thread) => thread.projectName === project),
    [snapshot.threads, project]
  );

  const unresolved = openThreads(snapshot.threads).length;
  const { sync: syncState } = snapshot;

  return (
    <div className="dashboard-with-changelog">
      <div className="dashboard-scroll-container">
        <div className="dashboard-column">
          {!dashboardHeaderHidden && (
            <DashboardHeader
              title="What has your team been building?"
              onHide={hideDashboardHeader}
            />
          )}

          <section className="dashboard-panel team-panel">
            <div className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <div className="dashboard-section-heading-title">
                  <span className="dashboard-section-title text-style-h4">Team</span>
                  {unresolved > 0 && (
                    <span className="dashboard-section-count text-style-h4 font-weight-heading">
                      {unresolved}
                    </span>
                  )}
                </div>
              </div>

              <div className="dashboard-section-controls">
                <div className="dashboard-section-actions-left">
                  {/* `navigation` mode drops `aria-controls`, which is right
                      here: the tab strip lives in the section header and the
                      panels live further down in their own Tabs, so a panel id
                      from this instance would point at nothing. */}
                  <Tabs
                    value={tab}
                    onValueChange={(next) => setTeamTab(next as TeamTab)}
                    mode="navigation"
                  >
                    <TabsList aria-label="Team">
                      <TabsTab value="activity" leftIcon={<HistoryIcon size={12} />}>
                        Activity
                      </TabsTab>
                      <TabsTab value="people" leftIcon={<CollaboratorsIcon size={12} />}>
                        People
                      </TabsTab>
                      <TabsTab value="comments" leftIcon={<CommentIcon size={12} />}>
                        Comments
                      </TabsTab>
                    </TabsList>
                  </Tabs>

                  <Dropdown
                    trigger={(props) => (
                      <MenuButton
                        variant="secondary"
                        size="compact"
                        expanded={props['aria-expanded']}
                        {...props}
                      >
                        {project ?? 'All projects'}
                        <ChevronIcon
                          size={10}
                          className={props['aria-expanded'] ? 'chevron-flipped' : undefined}
                        />
                      </MenuButton>
                    )}
                  >
                    <DropdownItem active={project === null} onSelect={() => setProject(null)}>
                      All projects
                    </DropdownItem>
                    {projects.map((name) => (
                      <DropdownItem
                        key={name}
                        active={project === name}
                        onSelect={() => setProject(name)}
                      >
                        {name}
                      </DropdownItem>
                    ))}
                  </Dropdown>
                </div>

                <div className="dashboard-section-actions-right">
                  <Button
                    variant="ghost"
                    size="compact"
                    className="team-how-toggle"
                    leftIcon={<InfoIcon size={12} />}
                    onClick={() => setHowItWorksOpen(!howItWorksOpen)}
                    aria-expanded={howItWorksOpen}
                  >
                    How this works
                  </Button>
                </div>
              </div>
            </div>

            {/*
              The sync row. It is chrome, not a feature, but it is the one place
              the whole premise is visible: there is no server, so "up to date"
              means "last time we fetched", and unpushed work is nobody else's
              reality yet. Both numbers are stated rather than smoothed over.
            */}
            <div className="team-sync" data-state={syncState.repo ? 'linked' : 'local'}>
              <span className="team-sync-repo">
                <GitHubIcon size={12} />
                {syncState.repo ?? 'No GitHub remote — this project is single-player'}
              </span>

              {syncState.repo && (
                <>
                  <span className="team-sync-sep" aria-hidden />
                  <span className="team-sync-state">
                    {syncState.error ? (
                      <span className="team-sync-error">{syncState.error}</span>
                    ) : syncState.syncing ? (
                      'Fetching…'
                    ) : syncState.lastSyncedAt ? (
                      `Fetched ${formatAgo(syncState.lastSyncedAt, now)}`
                    ) : (
                      'Not fetched yet'
                    )}
                  </span>
                  {syncState.pendingCount > 0 && (
                    <span
                      className="team-sync-pending"
                      title="Written on this machine and not pushed. Nobody else can see these yet."
                    >
                      {syncState.pendingCount} not pushed
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="compact"
                    leftIcon={<PullIcon size={12} />}
                    onClick={() => void sync()}
                    disabled={syncState.syncing}
                  >
                    Sync now
                  </Button>
                </>
              )}
            </div>

            {howItWorksOpen && <TeamHowItWorks onClose={() => setHowItWorksOpen(false)} />}

            <div className="team-panel-body">
              <Tabs value={tab} onValueChange={(next) => setTeamTab(next as TeamTab)}>
                <TabsPanel value="activity">
                  <TeamActivityFeed events={events} projectFilter={project} now={now} />
                </TabsPanel>
                <TabsPanel value="people">
                  <TeamPeoplePanel members={snapshot.members} now={now} />
                </TabsPanel>
                <TabsPanel value="comments">
                  <TeamThreadsPanel threads={threads} showProject={project === null} now={now} />
                </TabsPanel>
              </Tabs>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
