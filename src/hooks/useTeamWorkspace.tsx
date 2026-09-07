/**
 * Wires the Team prototype into an open project.
 *
 * Three jobs, all of which the real build also has:
 *
 * 1. Point the store at the project that is actually open. In the real build
 *    this is `get_team_snapshot`; here it is the fixture adopting the project's
 *    name and repo, so what you see is your own project with people in it.
 * 2. Hold the panel's open state, and remember it per project — coming back to
 *    a workspace where you had the panel open should find it open.
 * 3. Announce work that arrives while you are looking.
 *
 * That third one is the whole feeling. Multiplayer is not a screen you visit;
 * it is something landing that you did not do. Here it is one scripted arrival
 * (see `buildIncomingUpdate`); in the real build it is whatever the next
 * `git fetch` pulls down, announced exactly the same way.
 *
 * @module hooks/useTeamWorkspace
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOptionalToast } from '../contexts/ToastContext';
import { usePolling } from './usePolling';
import { TeamPanel } from '../components/team/TeamPanel';
import { TeamPresence } from '../components/team/TeamPresence';
import { adopt, getSnapshot, subscribe, unseenUpdates } from '../lib/teamStore';

/**
 * How often the shared clock advances.
 *
 * Every team surface renders relative times, and one clock for all of them
 * means two rows written in the same second cannot disagree about "now". Half
 * a minute is under the resolution anyone reads ("6m ago") while keeping the
 * re-render rate negligible.
 */
const CLOCK_TICK_MS = 30_000;

const STORAGE_PREFIX = 'shipstudio.team.panelOpen:';

/**
 * Whether the panel was left open for this project.
 *
 * A stored preference is a convenience, so every failure mode — a private
 * window, cleared site data, a browser that throws on access — resolves to
 * "closed" rather than to an error.
 */
function readStoredOpen(projectPath: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${projectPath}`) === '1';
  } catch {
    return false;
  }
}

/**
 * @param project    the open project, whose name and path the fixture adopts
 * @param githubRepo `owner/repo`, or null when there is no GitHub remote
 */
export function useTeamWorkspace(
  project: { path: string; name: string },
  githubRepo: string | null
) {
  const { path: projectPath, name: projectName } = project;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { showToast } = useOptionalToast();

  const [open, setOpen] = useState(() => readStoredOpen(projectPath));

  // Point the fixture at this project. `adopt` is idempotent per path, so a
  // re-render or a returning visit does not reset a thread being replied to.
  useEffect(() => {
    adopt(projectPath, projectName, githubRepo);
  }, [projectPath, projectName, githubRepo]);

  // Re-read the preference when the project changes, using React's documented
  // "adjust state during render" pattern rather than an effect. An effect here
  // would render one frame with the previous project's panel state — and would
  // be a `set-state-in-effect` lint violation for exactly that reason.
  const [pathOfOpen, setPathOfOpen] = useState(projectPath);
  if (pathOfOpen !== projectPath) {
    setPathOfOpen(projectPath);
    setOpen(readStoredOpen(projectPath));
  }

  const setOpenPersisted = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${projectPath}`, next ? '1' : '0');
      } catch {
        // A rejected write costs the preference, never the interaction.
      }
    },
    [projectPath]
  );

  const toggle = useCallback(() => setOpenPersisted(!open), [open, setOpenPersisted]);

  // Announce anything that arrives after the first render of this project.
  // The ref starts unset so the initial backlog is not announced as news —
  // toasting seven updates the moment a project opens is not an arrival, it
  // is an ambush.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    knownIds.current = null;
  }, [projectPath]);

  useEffect(() => {
    const ids = new Set(snapshot.updates.map((update) => update.id));
    if (knownIds.current === null) {
      knownIds.current = ids;
      return;
    }
    const arrived = snapshot.updates.filter((update) => !knownIds.current!.has(update.id));
    knownIds.current = ids;
    for (const update of arrived) {
      showToast(`${update.actor.name}: ${update.headline}`, 'info');
    }
  }, [snapshot.updates, showToast]);

  // The shared clock. `usePolling` rather than a raw interval, per the repo's
  // own rule — it owns teardown and backoff in one place.
  const [now, setNow] = useState(() => Date.now());
  usePolling(
    useCallback(() => {
      setNow(Date.now());
      return Promise.resolve();
    }, []),
    { intervalMs: CLOCK_TICK_MS, name: 'team-clock' }
  );

  const close = useCallback(() => setOpenPersisted(false), [setOpenPersisted]);

  // Returns the two nodes rather than the state behind them, so the workspace
  // has one integration point instead of reassembling this at the call site.
  return {
    /** Goes in the workspace header's tool cluster. */
    presence: (
      <TeamPresence
        members={snapshot.members}
        unseenCount={unseenUpdates(snapshot).length}
        panelOpen={open}
        onTogglePanel={toggle}
        now={now}
      />
    ),
    /** Floats over the preview. Kept mounted so scroll position survives a toggle. */
    panel: <TeamPanel hidden={!open} onClose={close} now={now} />,
  };
}
