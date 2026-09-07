/**
 * Team — the frontend store.
 *
 * A `useSyncExternalStore` source shaped like `workflowsStore`, so the Team
 * surfaces read state the way every other screen does.
 *
 * State comes from `get_team_snapshot` (see `teamApi.ts`), which reads the
 * project's git history, its pull requests, and any records under
 * `.shipstudio-team/`. Nothing here folds, joins or derives — Rust owns every
 * claim about the repo, and this owns what is on screen.
 *
 * ## Two things live only here, and both are honest about it
 *
 * **Seen-ness** is per person, per machine. "New since you last looked" is not
 * a fact about the repo and must never be written into it — committing which
 * rows you have read would publish your reading habits to the whole team. It
 * goes to `localStorage`.
 *
 * **Pending replies** are comments typed before there is a writer to commit
 * them. They are kept, marked `pending`, and merged back over every refetch, so
 * a refresh does not silently eat something you typed. They persist to
 * `localStorage` for the same reason. When the writer lands they flush into
 * records and this buffer goes away.
 *
 * @module lib/teamStore
 */

import { getTeamSnapshot } from './teamApi';
import { asCommandError, formatCommandError } from './errors';
import { logger } from './logger';
import {
  actorKey,
  lastMessageAt,
  type TeamActor,
  type TeamMessage,
  type TeamSnapshot,
  type TeamThread,
  type TeamUpdate,
} from './team';

/**
 * How often the snapshot is re-read.
 *
 * This is the feature's entire notion of "real time", and it is worth being
 * explicit: with no server, nobody can tell us something happened, so the floor
 * is however often we ask. A minute is frequent enough that a conversation
 * works and infrequent enough not to hammer a remote all day.
 *
 * Note that this re-reads what is already local. Learning about a teammate's
 * push additionally needs a `git fetch`, which Ship Studio does not do behind
 * the user's back — see `sync()`.
 */
export const TEAM_SYNC_INTERVAL_MS = 60_000;

/** Which of the three Team surfaces is showing. */
export type TeamTab = 'updates' | 'people' | 'comments';

interface TeamUiState {
  tab: TeamTab;
  howItWorksOpen: boolean;
  /** The update expanded to show its evidence, if any. */
  expandedId: string | null;
  /** True until the first snapshot for the current project has arrived. */
  loading: boolean;
}

const SEEN_PREFIX = 'shipstudio.team.seen:';
const PENDING_PREFIX = 'shipstudio.team.pending:';

/** How many seen ids to keep. Past this the oldest are dropped. */
const MAX_SEEN = 500;

export function emptySnapshot(): TeamSnapshot {
  return {
    updates: [],
    members: [],
    threads: [],
    sync: { repo: null, lastSyncedAt: null, pendingCount: 0, error: null, syncing: false },
    seenIds: [],
  };
}

let state: TeamSnapshot = emptySnapshot();
let ui: TeamUiState = { tab: 'updates', howItWorksOpen: false, expandedId: null, loading: false };
let adoptedPath: string | null = null;
/** What the home screen last read across, so `sync()` can re-read the same set. */
let homeProjects: { path: string; name: string }[] = [];
/** Replies typed before there is a writer. Keyed by thread id. */
let pending = new Map<string, TeamMessage[]>();

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function emit(next: TeamSnapshot): void {
  state = next;
  notify();
}

function setUi(next: Partial<TeamUiState>): void {
  ui = { ...ui, ...next };
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
  setUi({ tab });
}

export function setHowItWorksOpen(open: boolean): void {
  if (ui.howItWorksOpen === open) return;
  setUi({ howItWorksOpen: open });
}

export function toggleExpanded(id: string): void {
  setUi({ expandedId: ui.expandedId === id ? null : id });
}

// ------------------------------------------------------------- persistence

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // A private window, cleared site data, or a browser that throws on access.
    // Every one of them means "no preference", never an error.
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A rejected write costs the preference, never the interaction.
  }
}

function loadPending(projectPath: string): Map<string, TeamMessage[]> {
  const raw = readJson<Record<string, TeamMessage[]>>(`${PENDING_PREFIX}${projectPath}`, {});
  return new Map(Object.entries(raw));
}

function savePending(projectPath: string): void {
  writeJson(`${PENDING_PREFIX}${projectPath}`, Object.fromEntries(pending));
}

/**
 * Lay the local, unpushed replies back over a freshly read snapshot.
 *
 * A pending reply whose id now appears in the real thread has been committed
 * and fetched back, so it is dropped from the buffer — that is the one moment
 * this state is allowed to disappear, and it happens because the real thing
 * arrived.
 */
function mergePending(snapshot: TeamSnapshot): TeamSnapshot {
  if (pending.size === 0) return snapshot;

  let changed = false;
  const threads = snapshot.threads.map((thread) => {
    const extra = pending.get(thread.id);
    if (!extra || extra.length === 0) return thread;

    const landed = new Set(thread.messages.map((message) => message.id));
    const stillPending = extra.filter((message) => !landed.has(message.id));
    if (stillPending.length !== extra.length) {
      changed = true;
      if (stillPending.length === 0) pending.delete(thread.id);
      else pending.set(thread.id, stillPending);
    }
    if (stillPending.length === 0) return thread;
    return { ...thread, messages: [...thread.messages, ...stillPending] };
  });

  if (changed && adoptedPath) savePending(adoptedPath);

  const pendingCount = [...pending.values()].reduce((total, list) => total + list.length, 0);
  return { ...snapshot, threads, sync: { ...snapshot.sync, pendingCount } };
}

// ------------------------------------------------------------------ loading

/**
 * Point the store at the project the user opened, and read it.
 *
 * Idempotent per path: re-entering a workspace must not throw away a reply in
 * progress or re-announce the whole backlog as news.
 */
export function adopt(projectPath: string, _projectName?: string, _repo?: string | null): void {
  if (adoptedPath === projectPath) return;
  adoptedPath = projectPath;

  pending = loadPending(projectPath);
  // Clear immediately rather than leaving the previous project's feed on
  // screen under this project's name while the read is in flight.
  state = { ...emptySnapshot(), seenIds: readJson<string[]>(`${SEEN_PREFIX}${projectPath}`, []) };
  setUi({ loading: true, expandedId: null });

  void refresh(projectPath);
}

/** Re-read the snapshot for the adopted project. */
export async function refresh(projectPath = adoptedPath): Promise<void> {
  if (!projectPath) return;

  try {
    const snapshot = await getTeamSnapshot(projectPath);
    // Leaving the project mid-read must not drop another project's feed here.
    if (adoptedPath !== projectPath) return;
    emit(
      mergePending({
        ...snapshot,
        seenIds: state.seenIds,
        sync: { ...snapshot.sync, lastSyncedAt: Date.now(), error: null, syncing: false },
      })
    );
  } catch (error) {
    if (adoptedPath !== projectPath) return;
    const message = formatCommandError(asCommandError(error));
    logger.warn('team snapshot failed', { projectPath, error: message });
    // Kept, not swallowed: the panel says what went wrong rather than showing
    // an empty feed that reads as "nobody has done anything".
    emit({ ...state, sync: { ...state.sync, error: message, syncing: false } });
  } finally {
    if (adoptedPath === projectPath) setUi({ loading: false });
  }
}

/**
 * How many projects the home-level screen reads across.
 *
 * Each one is a full history walk plus a `gh pr list`, so this is a real cost
 * rather than a paranoid cap. Recently-opened is the right cut: a project you
 * have not touched in months is one whose team activity you are not waiting on.
 */
export const HOME_PROJECT_LIMIT = 8;

/** Marks the home-level read, so a project's own `adopt` can supersede it. */
const ALL_PROJECTS = ' all';

/**
 * Read across several projects at once, for the home-level Team screen.
 *
 * Failures are per project: a repo that has been deleted, or was never a git
 * repo, drops out of the feed and the other seven still render. The alternative
 * — one bad project blanking the screen — is the worse failure by far, and the
 * project filter makes the absence visible anyway.
 */
export async function adoptAll(projects: { path: string; name: string }[]): Promise<void> {
  const wanted = projects.slice(0, HOME_PROJECT_LIMIT);
  adoptedPath = ALL_PROJECTS;
  homeProjects = wanted;
  setUi({ loading: true });

  const results = await Promise.allSettled(wanted.map((project) => getTeamSnapshot(project.path)));
  // A project opened while this was in flight owns the store now.
  if (adoptedPath !== ALL_PROJECTS) return;

  const merged = emptySnapshot();
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push(wanted[index].name);
      return;
    }
    merged.updates.push(...result.value.updates);
    merged.threads.push(...result.value.threads);
    // Members are per project here: the same person on two repos is two rows,
    // each with the branch and the "doing" line for *that* project. Collapsing
    // them would have to pick one branch to show, and there is no honest way
    // to pick.
    merged.members.push(...result.value.members);
    if (!merged.sync.repo) merged.sync.repo = result.value.sync.repo;
  });

  merged.updates.sort((a, b) => b.at - a.at);
  merged.seenIds = readJson<string[]>(`${SEEN_PREFIX}${ALL_PROJECTS}`, []);
  merged.sync.lastSyncedAt = Date.now();
  merged.sync.error =
    failures.length > 0 ? `Couldn't read team activity for ${failures.join(', ')}` : null;

  emit(merged);
  setUi({ loading: false });
}

/**
 * Fetch from the remote, then re-read.
 *
 * The explicit-refresh path, and the only thing here that touches the network.
 * It is a plain `refresh` for now: Ship Studio does not run `git fetch` behind
 * the user's back, because a background fetch on someone's repo is a surprise
 * with bandwidth and credentials attached. Teammates' work appears when
 * something already in the app fetches — a branch switch, a pull, a PR check.
 */
export function sync(): Promise<void> {
  if (!adoptedPath || state.sync.syncing) return Promise.resolve();
  emit({ ...state, sync: { ...state.sync, syncing: true, error: null } });
  return adoptedPath === ALL_PROJECTS ? adoptAll(homeProjects) : refresh();
}

// -------------------------------------------------------------- seen / unseen

/** The signed-in user, or the first member when nobody is identified. */
export function currentActor(): TeamActor | null {
  return state.members.find((member) => member.isSelf)?.actor ?? null;
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

/**
 * Marks everything currently in the feed as seen.
 *
 * Local and private. Which rows you have read is not a fact about the repo, and
 * writing it into git would publish your reading habits to everyone with
 * access.
 */
export function markAllSeen(): void {
  const seenIds = [
    ...new Set([...state.seenIds, ...state.updates.map((update) => update.id)]),
  ].slice(-MAX_SEEN);
  emit({ ...state, seenIds });
  if (adoptedPath) writeJson(`${SEEN_PREFIX}${adoptedPath}`, seenIds);
}

// ------------------------------------------------------------------ threads

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-local-${Date.now().toString(36)}-${seq}`;
}

/**
 * Post a reply.
 *
 * Held locally and marked `pending` until there is a writer to commit it. The
 * UI says so — an unpushed reply is drawn as unpushed rather than as sent,
 * because "your teammate has not seen this" is the thing you need to know.
 */
export function replyToThread(threadId: string, body: string): void {
  const text = body.trim();
  if (!text) return;
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  const me = currentActor();
  if (!thread || !me) return;

  const message: TeamMessage = {
    id: nextId('m'),
    actor: me,
    at: Date.now(),
    body: text,
    pending: true,
  };
  pending.set(threadId, [...(pending.get(threadId) ?? []), message]);
  if (adoptedPath) savePending(adoptedPath);

  emit({
    ...state,
    threads: state.threads.map((candidate) =>
      candidate.id === threadId
        ? { ...candidate, messages: [...candidate.messages, message] }
        : candidate
    ),
    sync: { ...state.sync, pendingCount: state.sync.pendingCount + 1 },
  });
}

/**
 * Resolve or reopen a thread.
 *
 * Local until there is a writer, like a reply. In the committed form it is an
 * append rather than a field flip, because that is the only shape that survives
 * two people doing it at once: both records land, the fold takes the later one,
 * and nobody's decision is lost to a merge.
 */
export function setThreadResolved(threadId: string, resolved: boolean): void {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  const me = currentActor();
  if (!thread || thread.resolved === resolved) return;

  emit({
    ...state,
    threads: state.threads.map((candidate) =>
      candidate.id === threadId
        ? { ...candidate, resolved, resolvedBy: resolved ? me : null }
        : candidate
    ),
  });
}

/** Test seam: replace the whole snapshot. */
export function __setTeamState(next: TeamSnapshot): void {
  emit(next);
}

/** Test seam: back to an empty store, as if no project were open. */
export function __resetTeamState(): void {
  seq = 0;
  adoptedPath = null;
  pending = new Map();
  ui = { tab: 'updates', howItWorksOpen: false, expandedId: null, loading: false };
  emit(emptySnapshot());
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
