/**
 * Team — the shapes multiplayer Ship Studio is built out of.
 *
 * PROTOTYPE. Nothing here talks to a backend yet: `teamStore.ts` serves
 * fixtures. What is real is the *shape*, because the shape is the design
 * decision everything else has to live with.
 *
 * ## Git is the database
 *
 * There is no Ship Studio server, no websocket and no hosted database, and
 * there is not going to be one. A team's shared state is files in their own
 * git repository, and the network is `git fetch` / `git push`. That buys the
 * six things a multiplayer backend is normally built to provide:
 *
 * | Problem       | Solved by                                              |
 * | ------------- | ------------------------------------------------------ |
 * | Identity      | the GitHub login behind the push (`gh api user`)        |
 * | Authorization | repo access — no push right, no write                   |
 * | Durability    | it is a git repo, replicated on every clone             |
 * | Ordering      | ULID ids plus git history                               |
 * | Review        | pull requests                                           |
 * | Offline       | native; a clone is a full replica                       |
 *
 * ## Append-only, one file per event
 *
 * The single decision this feature lives or dies on. Every record below is
 * written **once**, to its own file named by its own id, and never modified:
 *
 *     .shipstudio-team/events/2026-09-07/01K4J8Q2-maya.json
 *
 * Two people acting in the same second produce two different files, so git
 * merges them with no conflict — by construction, not by luck. Put the same
 * data in one `activity.json` and every concurrent action is a merge conflict
 * in a JSON blob, which is the failure that ends the feature in week one.
 *
 * Mutation is therefore also an append. "Resolve this comment" is a new
 * `comment.resolved` event, not an edit of the comment. Current state is a
 * fold over the events, computed at read time. This is why the activity feed
 * is a byproduct of the design rather than a feature built on top of it — the
 * log *is* the database.
 *
 * ## Two provenances, and why the UI shows the difference
 *
 * `git` — reconstructed from git history itself: commits, branches, merges.
 * Cannot be forged without rewriting published history.
 *
 * `event` — a file some teammate's Ship Studio appended. Honest in practice
 * and unverifiable in principle: anyone who can push can write one, edit one,
 * or force-push the lot away.
 *
 * So this is an **activity feed, not an audit log**, and `TeamEvent.source`
 * exists so the UI can never quietly imply otherwise. Ship Studio does not
 * display data it cannot stand behind.
 *
 * @module lib/team
 */

/** Who did the thing. Resolved from git/GitHub — never typed by a user. */
export interface TeamActor {
  /**
   * GitHub login. The only globally unique handle available without a server,
   * and the join key against repo collaborators. Null for a commit whose
   * author never signed in to GitHub through Ship Studio.
   */
  login: string | null;
  /** `git config user.name`, or the GitHub display name. */
  name: string;
  /** Avatar URL from the GitHub API. Null renders initials, never a guess. */
  avatarUrl: string | null;
}

/**
 * Where a row came from, and therefore how much it can be trusted.
 *
 * - `git`   — derived from commits/branches. Verifiable against the repo.
 * - `event` — appended by a teammate's Ship Studio. Self-reported.
 */
export type TeamEventSource = 'git' | 'event';

/**
 * What kind of thing happened.
 *
 * Every kind maps to a Ship Studio feature that already exists, which is the
 * test for whether it belongs here: the feed reports the app's real work
 * rather than inventing telemetry to look busy.
 */
export type TeamEventKind =
  | 'commit.pushed'
  | 'branch.created'
  | 'pr.opened'
  | 'pr.merged'
  | 'comment.added'
  | 'comment.resolved'
  | 'workflow.ran'
  | 'finding.filed'
  | 'finding.fixed'
  | 'agent.session'
  | 'deploy.succeeded'
  | 'deploy.failed'
  | 'snapshot.restored';

/** The badge column — one per area of the app, mirroring the sidebar. */
export type TeamCategory = 'code' | 'review' | 'agent' | 'deploy' | 'findings';

export const TEAM_CATEGORY_LABEL: Record<TeamCategory, string> = {
  code: 'Code',
  review: 'Review',
  agent: 'Agent',
  deploy: 'Deploy',
  findings: 'Findings',
};

/** Which badge a kind wears. Exhaustive, so a new kind can't fall through. */
export const TEAM_EVENT_CATEGORY: Record<TeamEventKind, TeamCategory> = {
  'commit.pushed': 'code',
  'branch.created': 'code',
  'snapshot.restored': 'code',
  'pr.opened': 'review',
  'pr.merged': 'review',
  'comment.added': 'review',
  'comment.resolved': 'review',
  'workflow.ran': 'agent',
  'agent.session': 'agent',
  'finding.filed': 'findings',
  'finding.fixed': 'findings',
  'deploy.succeeded': 'deploy',
  'deploy.failed': 'deploy',
};

/**
 * A pointer back into the repo, so a row can be checked rather than believed.
 * A feed of unverifiable sentences is a rumour mill.
 */
export interface TeamEventRef {
  /** `commit` → a SHA, `pr` → a number, `branch` → a name, `file` → a path. */
  kind: 'commit' | 'pr' | 'branch' | 'file' | 'url';
  label: string;
  /** Opened externally when present (a PR, a deployment). */
  href?: string;
}

/** One row in the feed — exactly the JSON that would sit in one file. */
export interface TeamEvent {
  /** ULID. Chronologically sortable and unique with no coordination. */
  id: string;
  /**
   * Unix ms, from the author's clock.
   *
   * There is no server clock to correct against, so two machines with skewed
   * clocks interleave slightly wrong. The feed is grouped by day and shown in
   * relative time, which keeps skew below the resolution anyone reads.
   */
  at: number;
  actor: TeamActor;
  kind: TeamEventKind;
  source: TeamEventSource;
  projectName: string;
  projectPath: string;
  /** Branch the actor was on. Null for repo-wide events. */
  branch: string | null;
  /** Past tense, no subject: "pushed 3 commits to main". */
  summary: string;
  /** Second line, or null. Never padded with filler to make a row look full. */
  detail: string | null;
  refs: TeamEventRef[];
}

/**
 * A teammate and what they are demonstrably working on.
 *
 * Deliberately NOT presence. Nobody is "online" — there is no server to tell
 * us so, and a green dot meaning "had the app open when they last pushed" is
 * a lie with a nice UI. What a remote genuinely knows is: this person has a
 * branch, it moved at this time, it is this far ahead. That is real, it is
 * free, and it answers the question people actually ask.
 */
export interface TeamMember {
  actor: TeamActor;
  /** Repo role from the GitHub collaborators API. */
  role: 'admin' | 'maintainer' | 'write' | 'read';
  /** The branch their most recent commit landed on. Null = nothing pushed. */
  branch: string | null;
  projectName: string | null;
  /** When that commit landed. The only timestamp we can stand behind. */
  lastPushedAt: number | null;
  /** Commits on their branch not on the default branch. */
  commitsAhead: number;
  /** Open PR for that branch, when there is one. */
  prNumber: number | null;
  isSelf: boolean;
}

/** A comment thread, folded from its `comment.*` events. */
export interface TeamThread {
  id: string;
  projectName: string;
  projectPath: string;
  branch: string;
  /** The route the element was on, e.g. `/pricing`. */
  route: string;
  /** How a person would name the target: "section · Simple pricing". */
  target: string;
  /** The pin number drawn on the preview, so a person and an agent agree. */
  pin: number;
  resolved: boolean;
  resolvedBy: TeamActor | null;
  messages: TeamMessage[];
}

export interface TeamMessage {
  id: string;
  actor: TeamActor;
  at: number;
  body: string;
  /** Local and not yet pushed — the honest state between save and sync. */
  pending?: boolean;
}

/**
 * How this project's team data is reaching everyone else.
 *
 * `repo: null` is not an error state. A project with no GitHub remote is
 * simply single-player, and says so once rather than nagging.
 */
export interface TeamSyncStatus {
  /** `owner/repo`, or null when the project has no GitHub remote. */
  repo: string | null;
  /** Last successful fetch. Null = never synced this session. */
  lastSyncedAt: number | null;
  /** Written locally, not yet pushed. */
  pendingCount: number;
  /** Last sync failure, verbatim. Shown, never swallowed. */
  error: string | null;
  syncing: boolean;
}

/** Everything the Team screens read. */
export interface TeamSnapshot {
  events: TeamEvent[];
  members: TeamMember[];
  threads: TeamThread[];
  sync: TeamSyncStatus;
}

// ---------------------------------------------------------------- helpers

/**
 * Initials for an actor with no avatar.
 *
 * Two letters from two words, one from a single word — never a guessed
 * gravatar, and never a coloured circle standing in for a person we can't name.
 */
export function initialsOf(actor: TeamActor): string {
  const parts = actor.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * A stable swatch index for an actor, so one person keeps one colour across
 * every screen. Hashed from the login (or name) rather than from list order,
 * which would reshuffle every time someone new pushed.
 */
export function actorSwatch(actor: TeamActor, swatches: number): number {
  const key = actor.login ?? actor.name;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % swatches;
}

/** Day bucket for grouping the feed. Local midnight, matching the reader. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Mon, 2 Sep" — a heading, not a timestamp. */
export function dayLabel(timestamp: number, now = Date.now()): string {
  if (dayKey(timestamp) === dayKey(now)) return 'Today';
  if (dayKey(timestamp) === dayKey(now - 86_400_000)) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export interface TeamDayGroup {
  key: string;
  label: string;
  events: TeamEvent[];
}

/** Groups events into day buckets, preserving the order given. */
export function groupByDay(events: TeamEvent[], now = Date.now()): TeamDayGroup[] {
  const groups: TeamDayGroup[] = [];
  for (const event of events) {
    const key = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(event);
    else groups.push({ key, label: dayLabel(event.at, now), events: [event] });
  }
  return groups;
}

export function lastMessageAt(thread: TeamThread): number {
  return thread.messages[thread.messages.length - 1]?.at ?? 0;
}

/** Threads still wanting an answer, most recently active first. */
export function openThreads(threads: TeamThread[]): TeamThread[] {
  return threads
    .filter((thread) => !thread.resolved)
    .sort((a, b) => lastMessageAt(b) - lastMessageAt(a));
}

/**
 * Everyone who has said something in a thread, in the order they first spoke.
 * Drives the stacked avatars on a thread row.
 */
export function threadParticipants(thread: TeamThread): TeamActor[] {
  const seen = new Set<string>();
  const actors: TeamActor[] = [];
  for (const message of thread.messages) {
    const key = message.actor.login ?? message.actor.name;
    if (seen.has(key)) continue;
    seen.add(key);
    actors.push(message.actor);
  }
  return actors;
}
