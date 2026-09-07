/**
 * Team — the frontend store.
 *
 * A `useSyncExternalStore` source shaped exactly like `workflowsStore`, so the
 * Team screens read state the same way every other screen does and nothing has
 * to change when the data stops being invented.
 *
 * PROTOTYPE. State starts from `buildTeamFixture()` and lives in memory.
 * Mutations below are real — replying to a thread, resolving one, syncing —
 * and they update the store and re-render, so the UI can be *used* rather than
 * only looked at. They just never leave the tab.
 *
 * ## What replaces this
 *
 * Every mutation here is already written as an **append**, because that is how
 * the real one has to work (see `lib/team.ts`). `resolveThread` does not flip a
 * boolean on a record — it pushes a `comment.resolved` event and derives the
 * thread's state from it. So the wiring is:
 *
 * - `load()`      → `invoke('get_team_snapshot', { projectPath })`, which reads
 *                   the event files and folds them
 * - `append*()`   → `invoke('append_team_event', { projectPath, event })`,
 *                   which writes one file and debounces a commit
 * - `sync()`      → `invoke('sync_team_events', { projectPath })` — fetch, fold,
 *                   push anything pending
 * - the poll      → the same, on a timer, because without a server a fetch is
 *                   the only way anyone learns anything
 *
 * The optimistic path is not a nicety here, it is the honest model: a local
 * write IS local until a push succeeds, which is why `pending` exists on a
 * message and why the sync row counts unpushed events out loud.
 *
 * @module lib/teamStore
 */

import { buildTeamFixture } from './teamFixtures';
import {
  lastMessageAt,
  type TeamActor,
  type TeamEvent,
  type TeamSnapshot,
  type TeamThread,
} from './team';

/**
 * How often a real build would `git fetch` the team ref.
 *
 * This is the feature's entire notion of "real time" and it is worth being
 * explicit about: with no server, nobody can tell us something happened, so
 * the floor is however often we ask. A minute is frequent enough that a
 * conversation works and infrequent enough not to hammer someone's remote all
 * day. The prototype does not run it — there is nothing to fetch — but the
 * number is the design, so it lives here rather than in a component.
 */
export const TEAM_SYNC_INTERVAL_MS = 60_000;

/** Which of the three Team surfaces is showing. */
export type TeamTab = 'activity' | 'people' | 'comments';

/**
 * View state lives in the store rather than in `TeamView`'s `useState`, because
 * the palette has to be able to land on a specific tab.
 *
 * "Team comments" in Cmd+K should open the comments, not the Team screen with
 * comments one more click away — a palette command that gets you *near* the
 * thing is the failure mode the palette exists to avoid. A command can't reach
 * into a component's state, so the state moves out here.
 */
interface TeamUiState {
  tab: TeamTab;
  howItWorksOpen: boolean;
}

let state: TeamSnapshot = buildTeamFixture();
let ui: TeamUiState = { tab: 'activity', howItWorksOpen: false };
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

/** The signed-in user. Real build: the workspace's GitHub login. */
export function currentActor(): TeamActor {
  return state.members.find((member) => member.isSelf)?.actor ?? state.members[0].actor;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-local-${Date.now().toString(36)}-${seq}`;
}

/**
 * Append one event. Every mutation goes through here, which is what keeps the
 * activity feed complete without anyone remembering to also log their action.
 */
function appendEvent(event: Omit<TeamEvent, 'id' | 'at'>): TeamEvent {
  const full: TeamEvent = { ...event, id: nextId('ev'), at: Date.now() };
  emit({
    ...state,
    events: [full, ...state.events],
    sync: { ...state.sync, pendingCount: state.sync.pendingCount + 1 },
  });
  return full;
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
  });

  appendEvent({
    actor: me,
    kind: 'comment.added',
    source: 'event',
    projectName: thread.projectName,
    projectPath: thread.projectPath,
    branch: thread.branch,
    summary: `replied to a comment on ${thread.target}`,
    detail: text.length > 120 ? `${text.slice(0, 117)}…` : text,
    refs: [{ kind: 'file', label: thread.route }],
  });
}

/**
 * Resolve or reopen a thread.
 *
 * Written as an append rather than a field flip because that is the only form
 * that survives two people doing it at once: both events land, the fold takes
 * the later one, and nobody's work is lost to a merge.
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
  });

  appendEvent({
    actor: me,
    kind: resolved ? 'comment.resolved' : 'comment.added',
    source: 'event',
    projectName: thread.projectName,
    projectPath: thread.projectPath,
    branch: thread.branch,
    summary: resolved
      ? `resolved a comment on ${thread.target}`
      : `reopened a comment on ${thread.target}`,
    detail: null,
    refs: [{ kind: 'file', label: thread.route }],
  });
}

/**
 * Fetch, fold, push. In the prototype it flushes the pending count after a
 * beat, which is the only part of the round trip that is visible anyway.
 */
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
  emit(buildTeamFixture(now));
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
