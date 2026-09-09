import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useState } from 'react';
import { useCanvasCommentsLayer } from './CanvasComments';
import type { TeamSnapshot, TeamThread } from '../../lib/team';
import { adopt, refresh, __resetTeamState } from '../../lib/teamStore';
vi.mock('../../commands/useCommands', () => ({ useCommands: () => undefined }));

/**
 * A stand-in for the record files on disk.
 *
 * Comments are no longer this webview's localStorage — they are records the
 * whole team reads, so the thing worth asserting is what got written to the
 * repository. This fake is the repository: the real `teamStore` folds and
 * reconciles over it exactly as it does over the Rust command.
 */
const filed: TeamThread[] = [];
let nextRecordId = 0;
/** Makes the next retract reject, for the write-failure case. */
let retractFails = false;
/** Holds a comment write open, so a click can land while one is in flight. */
let writeGate: Promise<void> | null = null;

function snapshotOf(): TeamSnapshot {
  return {
    updates: [],
    members: [
      {
        actor: me,
        role: 'admin' as const,
        branch: null,
        projectName: null,
        lastPushedAt: null,
        commitsAhead: 0,
        prNumber: null,
        doing: null,
        explainsWork: true,
        isSelf: true,
      },
    ],
    threads: filed.map((thread) => ({ ...thread, messages: [...thread.messages] })),
    sync: { repo: null, lastSyncedAt: Date.now(), pendingCount: 0, error: null, syncing: false },
    seenIds: [],
    commitGuidanceInstalled: false,
  };
}

const me = { login: 'julian', name: 'Julian', avatarUrl: null };

vi.mock('../../lib/teamApi', () => ({
  getTeamSnapshot: () => Promise.resolve(snapshotOf()),
  addTeamComment: async (input: {
    route: string;
    target: string;
    pin: number;
    body: string;
    branch: string | null;
    anchor: unknown;
  }) => {
    if (writeGate) await writeGate;
    const id = `t${++nextRecordId}`;
    filed.push({
      id,
      projectName: 'test',
      projectPath: '/test',
      branch: input.branch ?? '',
      route: input.route,
      target: input.target,
      pin: input.pin,
      anchor: input.anchor as TeamThread['anchor'],
      resolved: false,
      resolvedBy: null,
      messages: [{ id, actor: me, at: Date.now(), body: input.body }],
    });
    return id;
  },
  editTeamMessage: (_p: string, threadId: string, messageId: string, body: string) => {
    const message = filed
      .find((thread) => thread.id === threadId)
      ?.messages.find((candidate) => candidate.id === messageId);
    if (message) message.body = body;
    return Promise.resolve(`e${++nextRecordId}`);
  },
  retractTeamMessage: (_p: string, threadId: string, messageId: string) => {
    if (retractFails) return Promise.reject(new Error('Disk unavailable'));
    const thread = filed.find((candidate) => candidate.id === threadId);
    if (thread) {
      thread.messages = thread.messages.filter((message) => message.id !== messageId);
      if (thread.messages.length === 0) filed.splice(filed.indexOf(thread), 1);
    }
    return Promise.resolve(`x${++nextRecordId}`);
  },
  replyToTeamThread: () => Promise.resolve('r1'),
  setTeamThreadResolved: () => Promise.resolve('s1'),
}));

/** The notes as they exist in the repository, pin order. */
function notes(): TeamThread[] {
  return [...filed].sort((a, b) => a.pin - b.pin);
}

/** Seed a note the way a save would have. */
function seed(body: string, pin: number): TeamThread {
  const id = `t${++nextRecordId}`;
  const thread: TeamThread = {
    id,
    projectName: 'test',
    projectPath: '/test',
    branch: 'main',
    route: '/',
    target: 'section · Hero',
    pin,
    anchor: {
      selector: '#hero',
      tag: 'section',
      ancestors: ['main'],
      classes: 'hero',
      heading: 'Hero',
      text: 'Hero',
      viewport: { x: 0, y: 0, width: 1440, height: 900 },
      rect: { x: 0, y: 0, width: 1440, height: 900 },
    },
    resolved: false,
    resolvedBy: null,
    messages: [{ id, actor: me, at: Date.now(), body }],
  };
  filed.push(thread);
  return thread;
}
vi.mock('../../contexts/ToastContext', () => ({
  useOptionalToast: () => ({ showToast: vi.fn() }),
}));
const target = {
  page: '/',
  selector: '#hero',
  tag: 'section',
  text: 'Hero',
  heading: 'Hero',
  classes: 'hero',
  ancestors: ['main'],
  viewport: { width: 1440, height: 900 },
  rect: { x: 0, y: 0, width: 1440, height: 900 },
};
beforeEach(async () => {
  localStorage.clear();
  filed.length = 0;
  nextRecordId = 0;
  retractFails = false;
  writeGate = null;
  __resetTeamState();
  adopt('/test');
  await refresh('/test');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});
function setup(send = vi.fn().mockResolvedValue(undefined)) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const ref = createRef<HTMLIFrameElement>();
  ref.current = iframe;
  function Harness() {
    const [open, setOpen] = useState(false);
    // The layer mounts in two places in the real app: the batch bar in the
    // workspace, the pins over the preview frame.
    const layer = useCanvasCommentsLayer({
      projectPath: '/test',
      branch: 'main',
      iframeRef: ref,
      agents: [{ id: 1, label: 'Codex 1', send }],
      activeAgentId: 1,
      currentPage: '/',
      navigate: vi.fn(),
      available: true,
      editing: false,
      stopEditing: vi.fn(),
      open,
      onOpenChange: setOpen,
    });
    return (
      <>
        <button onClick={() => setOpen(!open)}>Comments</button>
        {layer.pins(1, { w: 1440, h: 900 })}
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
  return {
    iframe,
    send,
    /** The frame reporting where each saved note's element currently sits. */
    locate: (notes: { id: string; x: number; y: number }[]) =>
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: iframe.contentWindow,
            data: {
              channel: 'ss:comments',
              type: 'locations',
              missing: [],
              page: '/',
              at: notes.map((n) => ({ ...n, width: 100, height: 40 })),
            },
          })
        )
      ),
    select: () =>
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: iframe.contentWindow,
            data: { channel: 'ss:comments', type: 'selected', target },
          })
        )
      ),
  };
}
it('adds a note to persistent backlog without calling the agent', async () => {
  const { send, select } = setup();
  await select();
  fireEvent.change(screen.getByLabelText('What should change?'), {
    target: { value: 'Please make this 80vh instead of 100vh.' },
  });
  fireEvent.click(screen.getByText('Save comment'));
  expect(screen.queryByText('Screenshot')).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
  await waitFor(() => expect(notes()).toHaveLength(1));
  expect(notes()[0].messages[0].body).toBe('Please make this 80vh instead of 100vh.');
});
/** Report placements, then open the pin for a note by its number. */
async function openPin(
  locate: (n: { id: string; x: number; y: number }[]) => Promise<unknown>,
  notes: { id: string; number: number }[],
  number: number
) {
  await locate(notes.map((n, i) => ({ id: n.id, x: 10, y: 20 + i * 50 })));
  const note = notes.find((n) => n.number === number)!;
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Comment ${note.number}:`) }));
}

it('switches targets without losing the note and keeps the composer compact', async () => {
  const { select, iframe } = setup();
  await select();
  fireEvent.change(screen.getByLabelText('What should change?'), {
    target: { value: 'Keep this draft' },
  });
  expect(screen.queryByText('Select parent')).not.toBeInTheDocument();
  expect(screen.queryByText('Send 0 comments to agent')).not.toBeInTheDocument();
  await act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { channel: 'ss:comments', type: 'escape' },
      })
    )
  );
  await act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          channel: 'ss:comments',
          type: 'selected',
          target: { ...target, selector: '#next', tag: 'section' },
        },
      })
    )
  );
  expect(screen.getByLabelText('What should change?')).toHaveValue('Keep this draft');
  expect(screen.getByTitle('#next')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(notes()).toHaveLength(1));
  expect(notes()[0].anchor?.selector).toBe('#next');
  expect(notes()[0].messages[0].body).toBe('Keep this draft');
});

it('asks only for the note, and carries the viewport it was written at', async () => {
  const { select, send, locate } = setup();
  await select();
  // No size picker: the viewport the user was on is the context.
  expect(screen.queryByRole('button', { name: 'Tablet' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'All sizes' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Apply to/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('What should change?'), {
    target: { value: 'Reduce heading size' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(notes()).toHaveLength(1));
  const saved = notes()[0];
  expect(saved.anchor?.viewport).toMatchObject({ width: 1440, height: 900 });
  expect(send).not.toHaveBeenCalled();
  await openPin(locate, [{ id: saved.id, number: saved.pin }], saved.pin);
  expect(screen.getByText(/Seen at 1440 × 900/)).toBeInTheDocument();
});

it('deletes a comment permanently with the trash control and preserves other notes', async () => {
  const first = seed('Make it 80vh', 1);
  const second = seed('Keep me', 2);
  const { locate } = setup();
  await refresh('/test');
  expect(screen.queryByText('Resolve')).not.toBeInTheDocument();
  expect(screen.queryByText('Reattach')).not.toBeInTheDocument();
  expect(screen.queryByText('Return to backlog')).not.toBeInTheDocument();
  await openPin(
    locate,
    [
      { id: first.id, number: 1 },
      { id: second.id, number: 2 },
    ],
    1
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete comment: Make it 80vh' }));
  await waitFor(() => expect(notes()).toHaveLength(1));
  expect(notes()[0].messages[0].body).toBe('Keep me');
});
it('keeps the comment visible if deletion fails', async () => {
  const only = seed('Make it 80vh', 1);
  const { locate } = setup();
  await refresh('/test');
  await openPin(locate, [{ id: only.id, number: 1 }], 1);
  // The record write rejects: the note must stay on screen, because the person
  // asked to remove it and it is still there.
  retractFails = true;
  fireEvent.click(screen.getByRole('button', { name: 'Delete comment: Make it 80vh' }));
  await waitFor(() => expect(notes()).toHaveLength(1));
  expect(screen.getByText('Make it 80vh')).toBeInTheDocument();
});

it('will not file the same note twice when the save button is clicked repeatedly', async () => {
  // Writing a record is asynchronous, and the gap was long enough to click
  // through: three clicks left three identical comments on one element, each
  // with its own id, because each click started its own write. The write is
  // held open here so the clicks land in the same window a person's would.
  let release!: () => void;
  writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { select } = setup();
  await select();
  fireEvent.change(screen.getByLabelText('What should change?'), {
    target: { value: 'Something' },
  });

  const save = screen.getByRole('button', { name: 'Save comment' });
  fireEvent.click(save);

  // Dead while the record is being written, and saying so.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));

  release();
  await waitFor(() => expect(notes()).toHaveLength(1));
  // Let anything a second write would have queued actually run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notes()).toHaveLength(1);
});

it('lists a note whose element could not be measured, but draws no pin for it', async () => {
  // A rect of zero area means the element was display:none or the frame had not
  // laid out. A pin placed from it lands in the corner and points at nothing.
  const unmeasurable = seed('Cannot place me', 1);
  unmeasurable.anchor = {
    ...unmeasurable.anchor!,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  };
  seed('Place me', 2);

  const { locate } = setup();
  await refresh('/test');
  await locate([]);

  // Both records survive; only the measurable one becomes a placeable note.
  expect(notes()).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Comment 1:/ })).not.toBeInTheDocument();
});
