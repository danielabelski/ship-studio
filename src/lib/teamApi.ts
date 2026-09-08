/**
 * Team — the Tauri boundary.
 *
 * One call, deliberately. `get_team_snapshot` reads git, `gh` and
 * `.shipstudio-team/` and returns the whole shape in `team.ts`; the frontend
 * does no folding, no joining and no status derivation of its own.
 *
 * That is not just tidiness. Every one of those is a *claim about the repo*,
 * and claims about the repo have to be made in one place or two surfaces will
 * eventually disagree about whether a branch is merged. Rust has the repo; the
 * frontend has the pixels.
 *
 * @module lib/teamApi
 */

import { invoke } from '@tauri-apps/api/core';
import type { TeamSnapshot, TeamSyncOutcome, TeamThreadAnchor } from './team';

/**
 * Read everything the Team surfaces show for one project.
 *
 * Never rejects for a state of the repo. No remote, no `gh`, not signed in, no
 * commits, nobody else on the repo, not a git repository at all — every one of
 * them comes back as a snapshot that honestly contains less, because those are
 * ordinary states rather than failures. A folder that was never `git init`ed
 * still returns its comments in full.
 */
export function getTeamSnapshot(projectPath: string): Promise<TeamSnapshot> {
  return invoke<TeamSnapshot>('get_team_snapshot', { projectPath });
}

/**
 * Leave a comment. Resolves with the new thread's id.
 *
 * Writes a file and nothing else — no commit, no network — so this works on a
 * project with no git repository and returns at the speed of a disk write.
 */
export function addTeamComment(input: {
  projectPath: string;
  branch: string | null;
  route: string;
  target: string;
  pin: number;
  body: string;
  anchor: TeamThreadAnchor | null;
}): Promise<string> {
  return invoke<string>('add_team_comment', input);
}

/** Reply on a thread. Resolves with the new record's id. */
export function replyToTeamThread(
  projectPath: string,
  threadId: string,
  body: string
): Promise<string> {
  return invoke<string>('reply_to_team_thread', { projectPath, threadId, body });
}

/** Resolve or reopen a thread. Resolves with the new record's id. */
export function setTeamThreadResolved(
  projectPath: string,
  threadId: string,
  resolved: boolean
): Promise<string> {
  return invoke<string>('set_team_thread_resolved', { projectPath, threadId, resolved });
}

/**
 * Rewrite a message you wrote.
 *
 * Authorship is enforced when records are folded, not here — an edit of
 * someone else's message is written and then never rendered, by anyone.
 */
export function editTeamMessage(
  projectPath: string,
  threadId: string,
  messageId: string,
  body: string
): Promise<string> {
  return invoke<string>('edit_team_message', { projectPath, threadId, messageId, body });
}

/**
 * Withdraw a message you wrote.
 *
 * Not a delete: the original record stays on disk and in every clone that
 * fetched it. What changes is what the feed shows, and the UI says exactly
 * that rather than promising erasure it cannot deliver.
 */
export function retractTeamMessage(
  projectPath: string,
  threadId: string,
  messageId: string
): Promise<string> {
  return invoke<string>('retract_team_message', { projectPath, threadId, messageId });
}

/**
 * Fetch other people's comments, then publish yours.
 *
 * The only call in the feature that touches the network. It resolves with what
 * happened rather than rejecting on a failed push: the comment is still on
 * disk, and the panel has to be able to say so.
 */
export function syncTeamThreads(projectPath: string): Promise<TeamSyncOutcome> {
  return invoke<TeamSyncOutcome>('sync_team_threads', { projectPath });
}

/**
 * Append the commit-message block to this project's `CLAUDE.md`/`AGENTS.md`.
 *
 * The durable version of "ask your agent to write better commits": a skill has
 * to trigger, and `push` is a one-word prompt carrying almost no signal, but
 * the project's instruction file is read at the start of every session by every
 * agent whether or not anything fires.
 *
 * Idempotent, and it resolves with the file it wrote to — which the caller
 * shows, because this edits a tracked file in the user's repository and they
 * should be told which one.
 */
export function installCommitGuidance(projectPath: string): Promise<string> {
  return invoke<string>('install_commit_guidance', { projectPath });
}
