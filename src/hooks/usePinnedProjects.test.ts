import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockInvokeResponse } from '../test/setup';
import { sessionRegistry } from '../lib/sessionRegistry';
import { usePinnedProjects } from './usePinnedProjects';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('usePinnedProjects reorder persistence', () => {
  beforeEach(() => {
    sessionRegistry._resetForTests();
  });

  afterEach(() => {
    sessionRegistry._resetForTests();
  });

  async function renderPinned(initial: string[] = ['/projects/alpha', '/projects/beta']) {
    mockInvokeResponse('list_pinned_projects', initial);
    const hook = renderHook(() => usePinnedProjects(null));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }

  it('rehydrates the persisted canonical order on mount', async () => {
    const hook = await renderPinned(['/projects/beta', '/projects/alpha']);

    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/beta', '/projects/alpha']);
  });

  it('applies an optimistic order, commits once, and adopts the canonical response', async () => {
    const response = vi.fn(() => Promise.resolve(['/projects/beta', '/projects/alpha']));
    mockInvokeResponse('reorder_pins', response);
    const hook = await renderPinned();

    let commit!: Promise<void>;
    act(() => {
      commit = hook.result.current.reorder(['/projects/beta', '/projects/alpha']);
    });
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
    await act(async () => {
      await commit;
    });
    expect(response).toHaveBeenCalledOnce();
    expect(response).toHaveBeenCalledWith({
      orderedPaths: ['/projects/beta', '/projects/alpha'],
    });
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/beta', '/projects/alpha']);
  });

  it('rehydrates the committed order after the hook remounts', async () => {
    let persisted = ['/projects/alpha', '/projects/beta'];
    mockInvokeResponse('list_pinned_projects', () => [...persisted]);
    mockInvokeResponse('reorder_pins', (args: unknown) => {
      const orderedPaths = (args as { orderedPaths: string[] }).orderedPaths;
      persisted = [...orderedPaths];
      return [...persisted];
    });
    const first = renderHook(() => usePinnedProjects(null));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    await act(async () => {
      await first.result.current.reorder(['/projects/beta', '/projects/alpha']);
    });
    first.unmount();

    const second = renderHook(() => usePinnedProjects(null));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
  });

  it('rolls back to the last confirmed order when persistence fails', async () => {
    const response = vi.fn(() => Promise.reject(new Error('pins unavailable')));
    mockInvokeResponse('reorder_pins', response);
    const hook = await renderPinned();

    let commit!: Promise<void>;
    act(() => {
      commit = hook.result.current.reorder(['/projects/beta', '/projects/alpha']);
    });
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);

    await act(async () => {
      await expect(commit).rejects.toThrow('pins unavailable');
    });
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/alpha',
      '/projects/beta',
    ]);
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/alpha', '/projects/beta']);
  });

  it('keeps confirmed order stable during an optimistic reorder, then adopts canonical order', async () => {
    const commitResponse = deferred<string[]>();
    mockInvokeResponse('reorder_pins', () => commitResponse.promise);
    const hook = await renderPinned();

    let commit!: Promise<void>;
    act(() => {
      commit = hook.result.current.reorder(['/projects/beta', '/projects/alpha']);
    });

    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/alpha', '/projects/beta']);

    await act(async () => {
      commitResponse.resolve(['/projects/beta', '/projects/alpha']);
      await commit;
    });
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/beta', '/projects/alpha']);
  });

  it('serializes commits and sends each requested order exactly once', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const response = vi.fn((args: { orderedPaths: string[] }) => {
      void args;
      return response.mock.calls.length === 1 ? first.promise : second.promise;
    });
    mockInvokeResponse('reorder_pins', response);
    const hook = await renderPinned();

    let firstCommit!: Promise<void>;
    let secondCommit!: Promise<void>;
    act(() => {
      firstCommit = hook.result.current.reorder(['/projects/beta', '/projects/alpha']);
      secondCommit = hook.result.current.reorder(['/projects/alpha', '/projects/beta']);
    });

    await waitFor(() => expect(response).toHaveBeenCalledOnce());
    expect(response.mock.calls[0]?.[0]).toEqual({
      orderedPaths: ['/projects/beta', '/projects/alpha'],
    });
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/alpha',
      '/projects/beta',
    ]);
    expect(hook.result.current.confirmedPaths).toEqual(['/projects/alpha', '/projects/beta']);

    await act(async () => {
      first.resolve(['/projects/beta', '/projects/alpha']);
      await firstCommit;
    });
    await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
    expect(response.mock.calls[1]?.[0]).toEqual({
      orderedPaths: ['/projects/alpha', '/projects/beta'],
    });

    await act(async () => {
      second.resolve(['/projects/alpha', '/projects/beta']);
      await secondCommit;
    });
    expect(response).toHaveBeenCalledTimes(2);
  });

  it('defers refresh reconciliation until an active commit completes', async () => {
    const listResponse = vi
      .fn()
      .mockResolvedValueOnce(['/projects/alpha', '/projects/beta'])
      .mockResolvedValueOnce(['/projects/beta', '/projects/alpha']);
    const commitResponse = deferred<string[]>();
    mockInvokeResponse('list_pinned_projects', listResponse);
    mockInvokeResponse('reorder_pins', () => commitResponse.promise);
    const hook = renderHook(() => usePinnedProjects(null));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    let commit!: Promise<void>;
    act(() => {
      commit = hook.result.current.reorder(['/projects/beta', '/projects/alpha']);
    });
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(listResponse).toHaveBeenCalledOnce();
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);

    await act(async () => {
      commitResponse.resolve(['/projects/beta', '/projects/alpha']);
      await commit;
    });
    await waitFor(() => expect(listResponse).toHaveBeenCalledTimes(2));
    expect(hook.result.current.rows.map((row) => row.projectPath)).toEqual([
      '/projects/beta',
      '/projects/alpha',
    ]);
  });
});
