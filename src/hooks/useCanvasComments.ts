/**
 * The pin backlog, over the shared comment records.
 *
 * This used to be localStorage: notes were "not committed, synced, or shared
 * with other users", which made a comment a private annotation. It is now a
 * thin adapter over `teamStore`, so the note you leave on an element is the
 * same object your teammate replies to and your agent resolves.
 *
 * The pins, the composer and the batch panel above this are unchanged — they
 * still speak `CanvasComment`, which this maps records into.
 *
 * ## What is still local, and why
 *
 * `status: 'sent'`, `sentTo` and `batchId` say *I pasted this into my terminal
 * on this machine*. That is not a fact about the repository and must not be
 * written into it — committing it would tell the whole team which notes you
 * personally handed to an agent, and would make two people's handoffs fight
 * over the same field. It stays in localStorage, keyed by thread id, and a
 * missing entry simply means "not sent", which is the right default anywhere.
 *
 * Resolution is the opposite: it is a decision about the work, everyone needs
 * to see it, and it comes from the records.
 *
 * @module hooks/useCanvasComments
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type CanvasComment, type CommentStatus, type CommentTarget } from '../lib/canvasComments';
import { useOptionalToast } from '../contexts/ToastContext';
import { addComment, editMessage, getSnapshot, retractMessage, subscribe } from '../lib/teamStore';
import type { TeamThread, TeamThreadAnchor } from '../lib/team';

/** Per-machine handoff state. Never written into the repository. */
interface LocalSendState {
  sentAt?: string;
  sentTo?: string;
  batchId?: string;
}

const SENT_PREFIX = 'shipstudio.comments.sent:';

function sentKey(projectPath: string): string {
  return `${SENT_PREFIX}${projectPath}`;
}

function readSent(projectPath: string): Record<string, LocalSendState> {
  try {
    const raw = localStorage.getItem(sentKey(projectPath));
    return raw ? (JSON.parse(raw) as Record<string, LocalSendState>) : {};
  } catch {
    return {};
  }
}

function writeSent(projectPath: string, value: Record<string, LocalSendState>): void {
  try {
    localStorage.setItem(sentKey(projectPath), JSON.stringify(value));
    window.dispatchEvent(new Event('shipstudio:comments-changed'));
  } catch {
    // Losing the sent marker costs a duplicate paste, never a comment.
  }
}

/**
 * A record's anchor, back in the shape the preview measures and draws with.
 *
 * A thread with no anchor cannot be placed, and this returns `null` for it
 * rather than a zeroed rect that would park a pin in the top-left corner and
 * claim the element is there.
 */
function targetFromThread(thread: TeamThread): CommentTarget | null {
  const anchor: TeamThreadAnchor | undefined = thread.anchor;
  if (!anchor || !anchor.selector || !anchor.viewport || !anchor.rect) return null;
  // A zero-area rect means the element was not measurable when the note was
  // written — display:none, or a frame that had not laid out yet. Drawing a pin
  // from it parks it in the top-left corner and claims the element is there.
  if (anchor.rect.width <= 0 || anchor.rect.height <= 0) return null;
  if (anchor.viewport.width <= 0 || anchor.viewport.height <= 0) return null;
  return {
    page: thread.route || '/',
    selector: anchor.selector,
    tag: anchor.tag,
    text: anchor.text,
    heading: anchor.heading,
    classes: anchor.classes,
    ancestors: anchor.ancestors,
    viewport: { width: anchor.viewport.width, height: anchor.viewport.height },
    rect: anchor.rect,
    source: anchor.source,
  };
}

/** The shape the pins and the panel already speak. */
function toComment(thread: TeamThread, sent: LocalSendState | undefined): CanvasComment | null {
  const target = targetFromThread(thread);
  const first = thread.messages[0];
  if (!target || !first) return null;

  const status: CommentStatus = thread.resolved ? 'resolved' : sent?.sentAt ? 'sent' : 'pending';

  return {
    id: thread.id,
    number: thread.pin,
    target,
    body: first.body,
    status,
    createdAt: new Date(first.at).toISOString(),
    sentAt: sent?.sentAt,
    sentTo: sent?.sentTo,
    batchId: sent?.batchId,
  };
}

/**
 * @param projectPath the open project — comment records live under it
 * @param branch recorded on the comment so a reader knows what it was about.
 *   Empty on a project with no repository, which is allowed: a note about a
 *   page does not need a branch to be worth writing.
 */
export function useCanvasComments(projectPath: string, branch: string) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { showToast } = useOptionalToast();

  // Re-read on the same event the sent map is written on, so a handoff repaints
  // the pins without waiting for the next snapshot poll.
  const sentMap = useSyncExternalStore(
    useCallback((refresh: () => void) => {
      window.addEventListener('storage', refresh);
      window.addEventListener('shipstudio:comments-changed', refresh);
      return () => {
        window.removeEventListener('storage', refresh);
        window.removeEventListener('shipstudio:comments-changed', refresh);
      };
    }, []),
    useCallback(() => localStorage.getItem(sentKey(projectPath)) ?? '', [projectPath])
  );

  const comments = useMemo(() => {
    const sent = sentMap ? (JSON.parse(sentMap) as Record<string, LocalSendState>) : {};
    return snapshot.threads
      .map((thread) => toComment(thread, sent[thread.id]))
      .filter((comment): comment is CanvasComment => comment !== null)
      .sort((a, b) => a.number - b.number);
  }, [snapshot.threads, sentMap]);

  const error = snapshot.sync.error;

  const add = useCallback(
    async (target: CommentTarget, body: string): Promise<boolean> => {
      if (!body.trim()) return false;
      // Pin numbers are per-person and never renumbered by the fold, so the
      // next one only has to be free on this machine's view of the thread list.
      const next = Math.max(0, ...comments.map((comment) => comment.number)) + 1;
      const id = await addComment({
        route: target.page,
        target: describeTarget(target),
        pin: next,
        body,
        branch: branch || null,
        anchor: {
          selector: target.selector,
          tag: target.tag,
          ancestors: target.ancestors,
          classes: target.classes,
          heading: target.heading,
          text: target.text,
          viewport: { x: 0, y: 0, ...target.viewport },
          rect: target.rect,
          source: target.source,
        },
      });
      if (!id) {
        showToast('Could not save this comment. Nothing was lost — try again.', 'error');
        return false;
      }
      return true;
    },
    [branch, comments, showToast]
  );

  /**
   * Change a note.
   *
   * Body edits become an `edit` record. Handoff fields are local and go to
   * localStorage. A call carrying both does both, which is what the send flow
   * does when it marks a batch sent.
   */
  const update = useCallback(
    async (id: string, patch: Partial<CanvasComment>): Promise<boolean> => {
      const thread = snapshot.threads.find((candidate) => candidate.id === id);
      if (!thread) return false;

      if (patch.status !== undefined || patch.sentAt !== undefined || patch.sentTo !== undefined) {
        const map = readSent(projectPath);
        if (patch.status === 'pending') delete map[id];
        else
          map[id] = {
            sentAt: patch.sentAt,
            sentTo: patch.sentTo,
            batchId: patch.batchId,
          };
        writeSent(projectPath, map);
      }

      if (patch.body !== undefined && patch.body !== thread.messages[0]?.body) {
        const first = thread.messages[0];
        if (first && !(await editMessage(thread.id, first.id, patch.body))) return false;
      }
      return true;
    },
    [projectPath, snapshot.threads]
  );

  /**
   * Withdraw a note.
   *
   * The record stays in the repository's history — this takes it out of the
   * feed, which is what the person means and all git can honestly offer.
   */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const thread = snapshot.threads.find((candidate) => candidate.id === id);
      const first = thread?.messages[0];
      if (!thread || !first) return false;
      if (!(await retractMessage(thread.id, first.id))) return false;
      const map = readSent(projectPath);
      delete map[id];
      writeSent(projectPath, map);
      return true;
    },
    [projectPath, snapshot.threads]
  );

  return { comments, error, add, update, remove };
}

/** The one-line label a record carries for readers with no preview open. */
function describeTarget(target: CommentTarget): string {
  const detail = target.heading || target.text;
  return detail ? `${target.tag} · ${detail.slice(0, 60)}` : target.tag;
}
