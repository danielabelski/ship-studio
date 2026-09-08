import { beforeEach, expect, it, vi } from 'vitest';
import type { TeamSnapshot, TeamThread } from './team';

/** The repository, faked. `teamStore` folds and reconciles over it for real. */
let filed: TeamThread[] = [];
let failWrites = false;

const me = { login: 'julian', name: 'Julian', avatarUrl: null };

function snapshotOf(): TeamSnapshot {
  return {
    updates: [],
    members: [],
    threads: filed.map((thread) => ({ ...thread, messages: [...thread.messages] })),
    sync: { repo: null, lastSyncedAt: Date.now(), pendingCount: 0, error: null, syncing: false },
    seenIds: [],
    commitGuidanceInstalled: false,
  };
}

/** How many times the remote was actually asked. */
let syncCalls = 0;
let syncOutcome = {
  pulled: 0,
  pushed: 0,
  pending: 0,
  error: null as string | null,
  hasRemote: true,
};

vi.mock('./teamApi', () => ({
  getTeamSnapshot: () => Promise.resolve(snapshotOf()),
  syncTeamThreads: () => {
    syncCalls += 1;
    return Promise.resolve(syncOutcome);
  },
  addTeamComment: () => Promise.resolve('t-new'),
  replyToTeamThread: (_p: string, threadId: string, body: string) => {
    if (failWrites) return Promise.reject(new Error('Disk unavailable'));
    const thread = filed.find((candidate) => candidate.id === threadId);
    const id = `r-${thread?.messages.length ?? 0}`;
    thread?.messages.push({ id, actor: me, at: Date.now(), body });
    return Promise.resolve(id);
  },
  setTeamThreadResolved: (_p: string, threadId: string, resolved: boolean) => {
    const thread = filed.find((candidate) => candidate.id === threadId);
    if (thread) thread.resolved = resolved;
    return Promise.resolve('s1');
  },
  editTeamMessage: () => Promise.resolve('e1'),
  retractTeamMessage: (_p: string, threadId: string) => {
    filed = filed.filter((thread) => thread.id !== threadId);
    return Promise.resolve('x1');
  },
}));

const {
  __resetSyncClock,
  adopt,
  clearThreadSelection,
  getSnapshot,
  getUiSnapshot,
  refresh,
  replyToThread,
  setThreadResolved,
  toggleThreadSelected,
  sync,
  __resetTeamState,
} = await import('./teamStore');

function thread(id: string, body = 'note'): TeamThread {
  return {
    id,
    projectName: 'site',
    projectPath: '/site',
    branch: 'main',
    route: '/',
    target: 'h1',
    pin: 1,
    resolved: false,
    resolvedBy: null,
    messages: [{ id, actor: me, at: Date.now(), body }],
  };
}

beforeEach(async () => {
  localStorage.clear();
  filed = [thread('t1'), thread('t2')];
  failWrites = false;
  __resetTeamState();
  __resetSyncClock();
  clearThreadSelection();
  syncOutcome = { pulled: 0, pushed: 0, pending: 0, error: null, hasRemote: true };

  // `adopt` syncs on its own — opening a project is a trigger. Join that one
  // and settle before counting, so each test starts from a quiet store rather
  // than racing the open.
  adopt('/site');
  await sync(true);
  await refresh('/site');
  syncCalls = 0;
  __resetSyncClock();
});

it('starts with nothing selected', () => {
  expect(getUiSnapshot().selectedThreadIds).toEqual([]);
});

it('drops a selection once that thread is resolved by anyone', async () => {
  toggleThreadSelected('t1');
  toggleThreadSelected('t2');
  expect(getUiSnapshot().selectedThreadIds).toHaveLength(2);

  // Someone else resolved it and the next read brought that back.
  filed[0].resolved = true;
  await refresh('/site');

  expect(getUiSnapshot().selectedThreadIds).toEqual(['t2']);
});

it('drops a selection for a thread that is no longer there at all', async () => {
  toggleThreadSelected('t1');
  filed = filed.filter((candidate) => candidate.id !== 't1');
  await refresh('/site');
  expect(getUiSnapshot().selectedThreadIds).toEqual([]);
});

it('clears the selection when a different project is opened', () => {
  toggleThreadSelected('t1');
  adopt('/other-project');
  expect(getUiSnapshot().selectedThreadIds).toEqual([]);
});

it('keeps a reply that failed to write, still marked as not pushed', async () => {
  failWrites = true;
  await replyToThread('t1', 'this did not land');

  const stored = getSnapshot().threads.find((candidate) => candidate.id === 't1');
  const last = stored?.messages[stored.messages.length - 1];
  expect(last?.body).toBe('this did not land');
  expect(last?.pending).toBe(true);
  expect(getSnapshot().sync.error).toMatch(/post that reply/);
});

it('stops marking a reply pending once the record is read back', async () => {
  await replyToThread('t1', 'landed');
  const stored = getSnapshot().threads.find((candidate) => candidate.id === 't1');
  expect(stored?.messages).toHaveLength(2);
  expect(stored?.messages.every((message) => !message.pending)).toBe(true);
  expect(getSnapshot().sync.pendingCount).toBe(0);
});

it('does not re-post a reply that is only whitespace', async () => {
  await replyToThread('t1', '   ');
  expect(getSnapshot().threads.find((c) => c.id === 't1')?.messages).toHaveLength(1);
});

it('reopening a thread clears who resolved it', async () => {
  await setThreadResolved('t1', true);
  expect(getSnapshot().threads.find((c) => c.id === 't1')?.resolved).toBe(true);

  await setThreadResolved('t1', false);
  const reopened = getSnapshot().threads.find((c) => c.id === 't1');
  expect(reopened?.resolved).toBe(false);
  expect(reopened?.resolvedBy).toBeNull();
});

it('asks the remote once when several triggers land at the same moment', async () => {
  // A branch switch during a project open during a push. One exchange, not three.
  await Promise.all([sync(true), sync(true), sync(true)]);
  expect(syncCalls).toBe(1);
});

it('does not touch the remote again inside the floor', async () => {
  await sync(true);
  expect(syncCalls).toBe(1);

  // A background tick. The floor has not passed, so this is a local re-read.
  await sync();
  expect(syncCalls).toBe(1);
});

it('lets a trigger the user can see through the floor', async () => {
  await sync(true);
  await sync(true);
  expect(syncCalls).toBe(2);
});

it('reports a failed push without losing the comments', async () => {
  syncOutcome = {
    pulled: 0,
    pushed: 0,
    pending: 2,
    error:
      'Comments could not be shared: the remote is unreachable. They are saved on this machine.',
    hasRemote: true,
  };
  await sync(true);

  expect(getSnapshot().sync.error).toMatch(/saved on this machine/);
  expect(getSnapshot().sync.pendingCount).toBe(2);
  expect(getSnapshot().threads).toHaveLength(2);
});

it('says nothing is wrong when a project simply has no remote', async () => {
  syncOutcome = { pulled: 0, pushed: 0, pending: 1, error: null, hasRemote: false };
  await sync(true);
  expect(getSnapshot().sync.error).toBeNull();
  expect(getSnapshot().sync.pendingCount).toBe(1);
});

it('clears the pending count once the records are published', async () => {
  syncOutcome = { pulled: 0, pushed: 3, pending: 0, error: null, hasRemote: true };
  await sync(true);
  expect(getSnapshot().sync.pendingCount).toBe(0);
  expect(getSnapshot().sync.lastSyncedAt).not.toBeNull();
});
