/**
 * Team — the shapes multiplayer Ship Studio is built out of.
 *
 * PROTOTYPE. Nothing here talks to a backend yet: `teamStore.ts` serves
 * fixtures. What is real is the *shape*, because the shape is the design
 * decision everything else has to live with.
 *
 * ## The unit is what someone did, not what git recorded
 *
 * The first version of this modelled git events — pushed, merged, branched —
 * and it was useless. "Maya pushed 3 commits" tells you nothing you can act
 * on; a wall of those is a git log with faces on it, and nobody opens it
 * twice. Commit messages are written for the person who wrote them, an hour
 * later, and they never say *why*.
 *
 * So the unit here is a `TeamUpdate`: one sentence about what changed, why it
 * changed, and what it needs from you. The commits and files hang off it as
 * evidence you can expand — receipts for a claim, not the claim itself.
 *
 * That is what an agent is *for*. It just did the work, it has the whole
 * session in context, and it can say "the flex version could not hold three
 * columns at 1024 without wrapping, so I moved it to grid" — which no commit
 * message and no diff will ever tell you. Ship Studio can observe that a push
 * happened. Only the agent can say what it meant.
 *
 * ## Git is the database
 *
 * There is no Ship Studio server, no websocket and no hosted database. A
 * team's shared state is files in their own git repository, and the network is
 * `git fetch` / `git push`. That buys the six things a multiplayer backend is
 * normally built to provide:
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
 * ## Append-only, one file per update
 *
 * The single decision this feature lives or dies on. Every record is written
 * **once**, to its own file named by its own id, and never modified:
 *
 *     .shipstudio-team/updates/2026-09-07/01K4J8Q2-mayareed.json
 *
 * Two people writing in the same second produce two different files, so git
 * merges them with no conflict — by construction, not by luck. Put the same
 * data in one `activity.json` and every concurrent write is a merge conflict
 * in a JSON blob, which is the failure that ends the feature in week one.
 *
 * Mutation is therefore also an append: resolving a comment writes a new
 * record rather than editing the old one, and current state is a fold over
 * the records, computed at read time.
 *
 * ## Who writes an update
 *
 * `writtenBy` says which of three writers produced it, and the UI shows the
 * difference because they are not equally informative:
 *
 * - `agent`  — the agent that did the work, through a schema-checked tool.
 *              The rich ones. This is the path that makes the feed worth
 *              reading, and the one the bundled skill exists to teach.
 * - `person` — someone typed it (a comment, a note to the team).
 * - `app`    — Ship Studio noticed a push with no summary attached and
 *              recorded the bare fact. The thin fallback. It exists so that
 *              silence from an agent costs you the explanation rather than
 *              the entry, and it is deliberately drawn as the lesser row.
 *
 * @module lib/team
 */

/** Who did the thing. Resolved from git/GitHub — never typed by a user. */
export interface TeamActor {
  /**
   * GitHub login. The only globally unique handle available without a server,
   * and the join key against repo collaborators.
   */
  login: string | null;
  /** `git config user.name`, or the GitHub display name. */
  name: string;
  /** Avatar URL from the GitHub API. Null renders initials, never a guess. */
  avatarUrl: string | null;
}

/**
 * Which writer produced an update. See the module docs — this drives how much
 * the row is allowed to claim, and how prominently it is drawn.
 */
export type TeamUpdateAuthor = 'agent' | 'person' | 'app';

/**
 * Where a piece of work has got to.
 *
 * Every one of these is observable without a server: a branch exists, a PR is
 * open, a deployment matched the SHA. Nothing here is self-declared progress.
 */
export type TeamUpdateStatus =
  | 'working' // branch has moved recently, no PR yet
  | 'needs-review' // PR open, no review
  | 'in-review' // PR open, review requested or in progress
  | 'merged'
  | 'deployed'
  | 'broken'; // pushed, and the host's build failed

export const TEAM_STATUS_LABEL: Record<TeamUpdateStatus, string> = {
  working: 'In progress',
  'needs-review': 'Needs review',
  'in-review': 'In review',
  merged: 'Merged',
  deployed: 'Live',
  broken: 'Build failed',
};

/** A file the update touched, with the shape of the change. */
export interface TeamFileTouch {
  path: string;
  added: number;
  removed: number;
}

/** A commit backing an update. Evidence, not content. */
export interface TeamCommit {
  sha: string;
  message: string;
}

/**
 * One thing someone did — the unit the whole feature is built on.
 *
 * Read the first three fields aloud and you have the standup. Everything
 * below `branch` is the receipt.
 */
export interface TeamUpdate {
  /** ULID. Chronologically sortable and unique with no coordination. */
  id: string;
  /**
   * Unix ms, from the author's clock.
   *
   * There is no server clock to correct against, so two machines with skewed
   * clocks interleave slightly wrong. Times are shown relative and grouped by
   * day, which keeps skew below the resolution anyone reads.
   */
  at: number;
  actor: TeamActor;
  writtenBy: TeamUpdateAuthor;
  /** Which agent wrote it, when `writtenBy` is `agent`. For attribution. */
  agentName: string | null;

  /**
   * What changed, in one line, in plain language. The row.
   * "Rebuilt the pricing tiers as a 3-up grid" — not "pushed 3 commits".
   */
  headline: string;
  /**
   * Why. The thing a commit message never says and a diff cannot show.
   * Null on an `app`-written row, which by definition does not know.
   */
  why: string | null;
  /** The specific changes, as a person would list them. */
  changes: string[];
  /**
   * What this needs from whoever is reading, if anything. Null is the common
   * case and must stay cheap — a feed where every row demands something is a
   * feed people stop opening.
   */
  asks: string | null;

  branch: string;
  status: TeamUpdateStatus;
  projectName: string;
  projectPath: string;

  // ---- evidence, collapsed by default ----
  commits: TeamCommit[];
  files: TeamFileTouch[];
  prNumber: number | null;
  /** Set when the host reported a failure, so the row can show the error. */
  buildError: string | null;
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
  commitsAhead: number;
  prNumber: number | null;
  /** One line on what they are up to, from their most recent update. */
  doing: string | null;
  isSelf: boolean;
}

/** A comment thread, folded from its comment records. */
export interface TeamThread {
  id: string;
  projectName: string;
  projectPath: string;
  branch: string;
  /** The route the element was on, e.g. `/pricing`. */
  route: string;
  /** How a person would name the target: "h1 · Simple pricing". */
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
  lastSyncedAt: number | null;
  pendingCount: number;
  /** Last sync failure, verbatim. Shown, never swallowed. */
  error: string | null;
  syncing: boolean;
}

/** Everything the Team surfaces read. */
export interface TeamSnapshot {
  updates: TeamUpdate[];
  members: TeamMember[];
  threads: TeamThread[];
  sync: TeamSyncStatus;
  /** Updates the user has already seen, so "new since you were here" works. */
  seenIds: string[];
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

export function actorKey(actor: TeamActor): string {
  return actor.login ?? actor.name;
}

/** Day bucket for grouping. Local midnight, matching the reader. */
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
  updates: TeamUpdate[];
}

/** Groups updates into day buckets, preserving the order given. */
export function groupByDay(updates: TeamUpdate[], now = Date.now()): TeamDayGroup[] {
  const groups: TeamDayGroup[] = [];
  for (const update of updates) {
    const key = dayKey(update.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.updates.push(update);
    else groups.push({ key, label: dayLabel(update.at, now), updates: [update] });
  }
  return groups;
}

/** Net lines touched, for the one-line evidence summary. */
export function fileTotals(files: TeamFileTouch[]): { added: number; removed: number } {
  return files.reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 }
  );
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
    const key = actorKey(message.actor);
    if (seen.has(key)) continue;
    seen.add(key);
    actors.push(message.actor);
  }
  return actors;
}

/**
 * Teammates with work in flight on this project, most recently active first.
 * The signed-in user is excluded — the header cluster answers "who else".
 */
export function activeTeammates(members: TeamMember[]): TeamMember[] {
  return members
    .filter((member) => !member.isSelf && member.lastPushedAt !== null)
    .sort((a, b) => (b.lastPushedAt ?? 0) - (a.lastPushedAt ?? 0));
}
