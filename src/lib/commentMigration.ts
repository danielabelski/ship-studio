/**
 * Moving pre-existing canvas comments into shared records.
 *
 * Comments used to live in this webview's localStorage, keyed by project *and
 * branch*, and documented as "not committed, synced, or shared with other
 * users". They are records now. Without this, everything someone wrote before
 * upgrading is still on their disk and permanently invisible — which is the
 * worst kind of data loss, because nothing anywhere says it happened.
 *
 * ## Rules this follows
 *
 * **Read once, write once, never delete.** The old keys are left exactly where
 * they are. If a migration goes wrong, or someone downgrades, their notes are
 * still there; the cost of leaving them is a few kilobytes of localStorage.
 *
 * **A marker per project, not a global flag.** Migration is per project because
 * records are, and a global "done" flag would skip every project opened after
 * the first.
 *
 * **The branch comes with them.** Old notes were per branch, records are not.
 * The branch they were saved under is a fact worth keeping, so it is written
 * onto the record rather than dropped — that is what the branch label in the
 * thread header will show.
 *
 * @module lib/commentMigration
 */

import { addTeamComment } from './teamApi';
import { isCommentTarget, type CanvasComment, type CommentTarget } from './canvasComments';
import { logger } from './logger';

const LEGACY_PREFIX = 'shipstudio.canvas-comments.v1:';
const DONE_PREFIX = 'shipstudio.team.migrated:';

/** One legacy note plus the branch its key was scoped to. */
interface LegacyNote {
  comment: CanvasComment;
  branch: string;
  key: string;
}

/**
 * Every legacy note for a project, across all the branches it was saved under.
 *
 * Parsed defensively: these have been sitting in storage across app versions,
 * and one unreadable entry must not stop the rest from being rescued.
 */
export function findLegacyNotes(projectPath: string): LegacyNote[] {
  const scope = `${LEGACY_PREFIX}${encodeURIComponent(projectPath)}:`;
  const found: LegacyNote[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(scope)) continue;

    // `<prefix><project>:<branch>:<id>` — the branch is the segment after the
    // project, and it was URI-encoded on the way in.
    const rest = key.slice(scope.length);
    const separator = rest.indexOf(':');
    if (separator < 0) continue;
    const branch = decodeURIComponent(rest.slice(0, separator));

    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as CanvasComment | null;
      if (!parsed || typeof parsed.body !== 'string' || !isCommentTarget(parsed.target)) continue;
      found.push({ comment: parsed, branch, key });
    } catch {
      // A note we cannot read is one we cannot move. It stays where it is.
    }
  }

  // Oldest first, so the records come out in the order they were written and
  // the fold numbers their pins the way the person originally saw them.
  return found.sort((a, b) => a.comment.createdAt.localeCompare(b.comment.createdAt));
}

function targetLabel(target: CommentTarget): string {
  const detail = target.heading || target.text;
  return detail ? `${target.tag} · ${detail.slice(0, 60)}` : target.tag;
}

function alreadyMigrated(projectPath: string): boolean {
  try {
    return localStorage.getItem(`${DONE_PREFIX}${projectPath}`) !== null;
  } catch {
    return false;
  }
}

function markMigrated(projectPath: string, count: number): void {
  try {
    localStorage.setItem(`${DONE_PREFIX}${projectPath}`, JSON.stringify({ at: Date.now(), count }));
  } catch {
    // Losing the marker costs a second migration attempt, which is harmless:
    // the records already exist and writing them again would be caught by the
    // marker on the next run anyway.
  }
}

/**
 * Move a project's legacy notes into records, once.
 *
 * Returns how many were moved, so the caller can tell the user rather than
 * doing it silently. Zero is the normal answer for everyone who never used the
 * old feature.
 */
export async function migrateLegacyComments(projectPath: string): Promise<number> {
  if (alreadyMigrated(projectPath)) return 0;

  const notes = findLegacyNotes(projectPath);
  if (notes.length === 0) {
    // Marked anyway: this project has nothing to move, and re-scanning every
    // key in storage on every open is work with a known answer.
    markMigrated(projectPath, 0);
    return 0;
  }

  let moved = 0;
  for (const [index, note] of notes.entries()) {
    const { comment, branch } = note;
    try {
      await addTeamComment({
        projectPath,
        branch: branch || null,
        route: comment.target.page,
        target: targetLabel(comment.target),
        pin: index + 1,
        body: comment.body,
        anchor: {
          selector: comment.target.selector,
          tag: comment.target.tag,
          ancestors: comment.target.ancestors,
          classes: comment.target.classes,
          heading: comment.target.heading,
          text: comment.target.text,
          viewport: { x: 0, y: 0, ...comment.target.viewport },
          rect: comment.target.rect,
          source: comment.target.source,
        },
      });
      moved += 1;
    } catch (error) {
      // One note that will not write must not strand the rest. The original is
      // untouched, so nothing is lost by carrying on.
      logger.warn('could not migrate a canvas comment', {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Marked even on a partial run: the notes that landed are records now, and
  // running again would duplicate them. What failed is still in localStorage.
  markMigrated(projectPath, moved);
  if (moved > 0) logger.info('migrated canvas comments into team records', { projectPath, moved });
  return moved;
}
