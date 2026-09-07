/**
 * Team — the frontend store.
 *
 * A `useSyncExternalStore` source shaped like `workflowsStore`, so the Team
 * surfaces read state the way every other screen does and nothing changes
 * shape when the data stops being invented.
 *
 * PROTOTYPE. State starts from `buildTeamFixture()` and lives in memory.
 * Mutations are real — replying, resolving, syncing, marking seen — so the UI
 * can be *used* rather than only looked at. They never leave the tab.
 *
 * ## What replaces this
 *
 * Every mutation is already written as an **append**, because that is how the
 * real one has to work (see `lib/team.ts`):
 *
 * - `adopt()`     → `invoke('get_team_snapshot', { projectPath })`, which reads
 *                   `.shipstudio-team/updates/**` and folds it
 * - `append*()`   → `invoke('append_team_record', { projectPath, record })`,
 *                   which writes one file and debounces a commit
 * - `sync()`      → `invoke('sync_team', { projectPath })` — fetch, fold, push
 * - the poll      → the same on a timer, because without a server a fetch is
 *                   the only way anyone learns anything
 *
 * @module lib/teamStore
 */

import { buildIncomingUpdate, buildTeamFixture } from './teamFixtures';
import {
  actorKey,
  lastMessageAt,
  type TeamActor,
  type TeamSnapshot,
  type TeamThread,
  type TeamUpdate,
} from './team';

/**
 * How often a real build would `git fetch` the team ref.
 *
 * This is the feature's entire notion of "real time", and it is worth being
 * explicit: with no server, nobody can tell us something happened, so the
 * floor is however often we ask. A minute is frequent enough that a
 * conversation works and infrequent enough not to hammer a remote all day.
 */
export const TEAM_SYNC_INTERVAL_MS = 60_000;

/**
 * When the scripted teammate update lands after a project opens.
 *
 * Long enough that it reads as someone else finishing something rather than
 * as a page-load animation, short enough that nobody has to wait around for
 * the demo. Prototype only — the real one arrives on a fetch.
 */
const INCOMING_AFTER_MS = 24_000;

/** Which of the three Team surfaces is showing. */
export type TeamTab = 'updates' | 'people' | 'comments';

interface TeamUiState {
  tab: TeamTab;
  howItWorksOpen: boolean;
  /** The update expanded to show its evidence, if any. */
  expandedId: string | null;
}

let state: TeamSnapshot = buildTeamFixture();
let ui: TeamUiState = { tab: 'updates', howItWorksOpen: false, expandedId: null };
let adoptedPath: string | null = null;
let incomingTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function emit(next: TeamSnapshot): void {
  state = next;
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): TeamSnapshot {
  return state;
}

export function getUiSnapshot(): TeamUiState {
  return ui;
}

export function setTeamTab(tab: TeamTab): void {
  if (ui.tab === tab) return;
  ui = { ...ui, tab };
  notify();
}

export function setHowItWorksOpen(open: boolean): void {
  if (ui.howItWorksOpen === open) return;
  ui = { ...ui, howItWorksOpen: open };
  notify();
}

export function toggleExpanded(id: string): void {
  ui = { ...ui, expandedId: ui.expandedId === id ? null : id };
  notify();
}

/**
 * Point the fixture at the project the user actually opened.
 *
 * The whole request this prototype answers is "let me open *my* project and
 * see people in it", so the invented team has to be about the real repo in
 * front of them rather than about a demo project they have never heard of.
 * In the real build this is the `get_team_snapshot` call, keyed the same way.
 *
 * Idempotent per project: re-entering a workspace must not reset a thread the
 * user has been replying in.
 */
export function adopt(projectPath: string, projectName: string, repo: string | null): void {
  if (adoptedPath === projectPath) return;
  adoptedPath = projectPath;

  const built = buildTeamFixture({ projectName, projectPath });
  emit({ ...built, sync: { ...built.sync, repo } });

  if (incomingTimer) clearTimeout(incomingTimer);
  incomingTimer = setTimeout(() => {
    // Guard on the path: leaving the project before this fires must not drop
    // someone else's project's update into this one's feed.
    if (adoptedPath !== projectPath) return;
    const incoming = buildIncomingUpdate(projectName, projectPath);
    emit({ ...state, updates: [incoming, ...state.updates] });
  }, INCOMING_AFTER_MS);
}

/** The signed-in user. Real build: the workspace's GitHub login. */
export function currentActor(): TeamActor {
  return state.members.find((member) => member.isSelf)?.actor ?? state.members[0].actor;
}

/** Updates the user has not seen yet — what the header badge counts. */
export function unseenUpdates(snapshot: TeamSnapshot): TeamUpdate[] {
  const seen = new Set(snapshot.seenIds);
  return snapshot.updates.filter(
    (update) => !seen.has(update.id) && !isSelf(snapshot, update.actor)
  );
}

function isSelf(snapshot: TeamSnapshot, candidate: TeamActor): boolean {
  const me = snapshot.members.find((member) => member.isSelf)?.actor;
  return me ? actorKey(me) === actorKey(candidate) : false;
}

/** Marks everything currently in the feed as seen. */
export function markAllSeen(): void {
  emit({ ...state, seenIds: state.updates.map((update) => update.id) });
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-local-${Date.now().toString(36)}-${seq}`;
}

/** Post a reply. Optimistic and marked `pending` until the next sync. */
export function replyToThread(threadId: string, body: string): void {
  const text = body.trim();
  if (!text) return;
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  const me = currentActor();

  emit({
    ...state,
    threads: state.threads.map((candidate) =>
      candidate.id === threadId
        ? {
            ...candidate,
            messages: [
              ...candidate.messages,
              { id: nextId('m'), actor: me, at: Date.now(), body: text, pending: true },
            ],
          }
        : candidate
    ),
    sync: { ...state.sync, pendingCount: state.sync.pendingCount + 1 },
  });
}

/**
 * Resolve or reopen a thread.
 *
 * An append in the real build rather than a field flip, because that is the
 * only form that survives two people doing it at once: both records land, the
 * fold takes the later one, and nobody's work is lost to a merge.
 */
export function setThreadResolved(threadId: string, resolved: boolean): void {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread || thread.resolved === resolved) return;
  const me = currentActor();

  emit({
    ...state,
    threads: state.threads.map((candidate) =>
      candidate.id === threadId
        ? { ...candidate, resolved, resolvedBy: resolved ? me : null }
        : candidate
    ),
    sync: { ...state.sync, pendingCount: state.sync.pendingCount + 1 },
  });
}

/** Fetch, fold, push. Here it just flushes the pending count after a beat. */
export function sync(): Promise<void> {
  if (state.sync.syncing) return Promise.resolve();
  emit({ ...state, sync: { ...state.sync, syncing: true, error: null } });

  return new Promise((resolve) => {
    setTimeout(() => {
      emit({
        ...state,
        threads: state.threads.map((thread) => ({
          ...thread,
          messages: thread.messages.map(({ pending: _pending, ...message }) => message),
        })),
        sync: {
          ...state.sync,
          syncing: false,
          pendingCount: 0,
          lastSyncedAt: Date.now(),
          error: null,
        },
      });
      resolve();
    }, 900);
  });
}

/** Test seam: replace the whole snapshot. */
export function __setTeamState(next: TeamSnapshot): void {
  emit(next);
}

/** Test seam: back to the shipped fixture. */
export function __resetTeamState(now?: number): void {
  seq = 0;
  adoptedPath = null;
  if (incomingTimer) clearTimeout(incomingTimer);
  emit(buildTeamFixture({ now }));
}

/** Threads for one project, unresolved first, most recently active first. */
export function threadsForProject(
  snapshot: TeamSnapshot,
  projectPath: string | null
): TeamThread[] {
  return snapshot.threads
    .filter((thread) => projectPath === null || thread.projectPath === projectPath)
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return lastMessageAt(b) - lastMessageAt(a);
    });
}
