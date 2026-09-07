/**
 * Comments, as a conversation between people rather than a private notepad.
 *
 * Canvas comments already exist and are deliberately local: "not committed,
 * synced, or shared with other users" (docs/canvas-comments.md). This is the
 * same note once the storage moves from this webview's localStorage into the
 * repo — the pin, the target and the route are unchanged, and what is added is
 * an author, replies, and a resolution someone else can see.
 *
 * Replying is optimistic and says so. A reply is written locally, marked
 * pending, and stays pending until a push succeeds — because that is literally
 * true, and a message that looks delivered while it sits unpushed on a laptop
 * is the single worst thing this feature could do to a team.
 *
 * @module components/team/TeamThreadsPanel
 */

import { useCallback, useMemo, useState } from 'react';
import { BranchIcon, CheckIcon, CommentIcon, PendingCircleIcon } from '@/components/icons';
import { Button } from '../primitives/Button';
import { EmptyState } from '../primitives/EmptyState';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { TeamAvatar, TeamAvatarStack } from './TeamAvatar';
import { formatAgo } from '../../lib/workflows';
import { lastMessageAt, threadParticipants, type TeamThread } from '../../lib/team';
import { replyToThread, setThreadResolved } from '../../lib/teamStore';

type ThreadFilter = 'open' | 'resolved' | 'all';

interface TeamThreadsPanelProps {
  threads: TeamThread[];
  showProject: boolean;
  now: number;
  /** Stacks the list over the reader for the 420px workspace panel. */
  compact?: boolean;
}

export function TeamThreadsPanel({
  threads,
  showProject,
  now,
  compact = false,
}: TeamThreadsPanelProps) {
  const [filter, setFilter] = useState<ThreadFilter>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const visible = useMemo(() => {
    const matches = threads.filter((thread) => {
      if (filter === 'open') return !thread.resolved;
      if (filter === 'resolved') return thread.resolved;
      return true;
    });
    return matches.sort((a, b) => lastMessageAt(b) - lastMessageAt(a));
  }, [threads, filter]);

  const selected = visible.find((thread) => thread.id === selectedId) ?? visible[0] ?? null;

  const handleReply = useCallback(() => {
    if (!selected || !draft.trim()) return;
    replyToThread(selected.id, draft);
    setDraft('');
  }, [selected, draft]);

  const openCount = threads.filter((thread) => !thread.resolved).length;

  return (
    <div className={`team-threads${compact ? ' is-compact' : ''}`}>
      <div className="team-threads-controls">
        <SegmentedControl
          aria-label="Filter comments"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'open', label: openCount > 0 ? `Open (${openCount})` : 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CommentIcon size={26} />}
          title={filter === 'open' ? 'No open comments' : 'Nothing here'}
          description={
            filter === 'open'
              ? 'Every comment on this repository has been resolved.'
              : 'No comments match this filter.'
          }
        />
      ) : (
        <div className="team-threads-body">
          <div className="team-thread-list" role="listbox" aria-label="Comment threads">
            {visible.map((thread) => {
              const last = thread.messages[thread.messages.length - 1];
              return (
                <button
                  key={thread.id}
                  type="button"
                  role="option"
                  aria-selected={thread.id === selected?.id}
                  className={`team-thread-item${thread.id === selected?.id ? ' is-selected' : ''}${
                    thread.resolved ? ' is-resolved' : ''
                  }`}
                  onClick={() => {
                    setSelectedId(thread.id);
                    setDraft('');
                  }}
                >
                  <span className="team-thread-item-top">
                    <span className="team-thread-pin" data-resolved={thread.resolved}>
                      {thread.pin}
                    </span>
                    <span className="team-thread-target">{thread.target}</span>
                    <span className="team-thread-age">{formatAgo(lastMessageAt(thread), now)}</span>
                  </span>
                  {last && <span className="team-thread-preview">{last.body}</span>}
                  <span className="team-thread-item-meta">
                    <TeamAvatarStack actors={threadParticipants(thread)} />
                    {showProject && <span className="team-chip">{thread.projectName}</span>}
                    <span className="team-thread-route">{thread.route}</span>
                    {thread.messages.length > 1 && (
                      <span className="team-thread-count">{thread.messages.length} replies</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="team-thread-pane">
            {selected && (
              <>
                <header className="team-thread-header">
                  <div className="team-thread-header-title">
                    <span className="team-thread-pin" data-resolved={selected.resolved}>
                      {selected.pin}
                    </span>
                    <h3 className="team-thread-heading">{selected.target}</h3>
                  </div>
                  <div className="team-thread-header-meta">
                    <span className="team-chip">{selected.projectName}</span>
                    <span className="team-thread-branch">
                      <BranchIcon size={10} />
                      {selected.branch}
                    </span>
                    <span className="team-thread-route">{selected.route}</span>
                  </div>
                </header>

                <div className="team-thread-messages">
                  {selected.messages.map((message) => (
                    <article className="team-message" key={message.id}>
                      <TeamAvatar actor={message.actor} size="md" />
                      <div className="team-message-body">
                        <div className="team-message-head">
                          <span className="team-message-author">{message.actor.name}</span>
                          <span className="team-message-age">{formatAgo(message.at, now)}</span>
                          {message.pending && (
                            <span
                              className="team-message-pending"
                              title="Written on this machine. Not pushed yet, so nobody else can see it."
                            >
                              <PendingCircleIcon size={9} />
                              not pushed
                            </span>
                          )}
                        </div>
                        <p className="team-message-text">{message.body}</p>
                      </div>
                    </article>
                  ))}

                  {selected.resolved && selected.resolvedBy && (
                    <div className="team-thread-resolved-note">
                      <CheckIcon size={11} />
                      Resolved by {selected.resolvedBy.name}
                    </div>
                  )}
                </div>

                <footer className="team-thread-composer">
                  <textarea
                    className="team-thread-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Reply to ${selected.messages[0]?.actor.name ?? 'this thread'}…`}
                    aria-label="Reply"
                    rows={2}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter breaks the line: this is a
                      // chat box, and the surrounding app is full of textareas
                      // where Enter means newline, so the affordance is
                      // spelled out beneath it rather than assumed.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleReply();
                      }
                    }}
                  />
                  <div className="team-thread-composer-actions">
                    <span className="team-thread-hint">
                      Enter to send · pushed to the repo on the next sync
                    </span>
                    <div className="team-thread-composer-buttons">
                      <Button
                        variant="secondary"
                        size="compact"
                        leftIcon={<CheckIcon size={12} />}
                        onClick={() => setThreadResolved(selected.id, !selected.resolved)}
                      >
                        {selected.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                      <Button
                        variant="primary"
                        size="compact"
                        disabled={!draft.trim()}
                        onClick={handleReply}
                      >
                        Reply
                      </Button>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
