import { render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockInvokeResponse } from '../test/setup';
import { getSnapshot, _reset } from './registry';
import { matchesContext } from './types';
import { PinnedProjectCommandHost, usePinnedProjectCommands } from './usePinnedProjectCommands';
import { resetFamilyRootsForTest } from '../lib/worktreeFamilies';
import { sessionRegistry } from '../lib/sessionRegistry';
import { getActiveProjectOrder, setActiveProjectOrder } from '../lib/activeProjectOrder';

describe('usePinnedProjectCommands', () => {
  afterEach(() => {
    _reset();
    resetFamilyRootsForTest();
    sessionRegistry._resetForTests();
    localStorage.clear();
  });

  it('uses a null-rendering host so command hooks stay outside AppContents', async () => {
    const onReorderProjects = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <PinnedProjectCommandHost
        pinnedPaths={['/projects/alpha', '/projects/beta']}
        currentProjectPath="/projects/alpha"
        onReorderProjects={onReorderProjects}
      />
    );

    expect(view.container).toBeEmptyDOMElement();
    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
  });

  it('registers valid up/down moves for the current pin and uses final indexes', async () => {
    const onReorderProjects = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePinnedProjectCommands({
        pinnedPaths: ['/projects/alpha', '/projects/beta', '/projects/gamma'],
        currentProjectPath: '/projects/beta',
        onReorderProjects,
      })
    );

    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
    const [up, down] = getSnapshot();
    expect(up?.title).toBe('Move pinned project up');
    expect(down?.title).toBe('Move pinned project down');
    expect(up?.when).toBeTypeOf('function');
    expect(down?.when).toBeTypeOf('function');
    expect(matchesContext(up?.when, { kind: 'project', currentProjectName: 'beta' })).toBe(true);
    expect(matchesContext(down?.when, { kind: 'project', currentProjectName: 'beta' })).toBe(true);

    await up?.run();
    expect(onReorderProjects).toHaveBeenCalledWith([
      '/projects/beta',
      '/projects/alpha',
      '/projects/gamma',
    ]);

    await down?.run();
    expect(onReorderProjects).toHaveBeenLastCalledWith([
      '/projects/alpha',
      '/projects/gamma',
      '/projects/beta',
    ]);
  });

  it('hides moves at the corresponding order boundaries and outside project context', async () => {
    const onReorderProjects = vi.fn();
    const { rerender } = renderHook(
      ({
        currentProjectPath,
        pinnedPaths,
      }: {
        currentProjectPath: string | null;
        pinnedPaths: string[];
      }) => usePinnedProjectCommands({ pinnedPaths, currentProjectPath, onReorderProjects }),
      {
        initialProps: {
          pinnedPaths: ['/projects/alpha', '/projects/beta'],
          currentProjectPath: '/projects/alpha',
        },
      }
    );

    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
    const [up, down] = getSnapshot();
    expect(matchesContext(up?.when, { kind: 'project', currentProjectName: 'alpha' })).toBe(false);
    expect(matchesContext(down?.when, { kind: 'project', currentProjectName: 'alpha' })).toBe(true);
    expect(matchesContext(up?.when, { kind: 'home', currentProjectName: null })).toBe(false);

    rerender({ pinnedPaths: ['/projects/alpha'], currentProjectPath: '/projects/alpha' });
    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
    expect(
      matchesContext(getSnapshot()[0]?.when, { kind: 'project', currentProjectName: 'alpha' })
    ).toBe(false);
    expect(
      matchesContext(getSnapshot()[1]?.when, { kind: 'project', currentProjectName: 'alpha' })
    ).toBe(false);
  });

  it('resolves a worktree session to its pinned family root', async () => {
    const onReorderProjects = vi.fn().mockResolvedValue(undefined);
    mockInvokeResponse('list_worktrees', [
      {
        path: '/Users/me/Desktop/Projects/marketing-site',
        head: '1234567',
        branch: 'main',
        is_main: true,
        is_current: false,
        locked: null,
        prunable: null,
        last_commit_date: null,
      },
      {
        path: '/Users/me/.worktrees/wrong-name/feature',
        head: 'abcdef0',
        branch: 'feature',
        is_main: false,
        is_current: true,
        locked: null,
        prunable: null,
        last_commit_date: null,
      },
    ]);
    renderHook(() =>
      usePinnedProjectCommands({
        pinnedPaths: ['/Users/me/Desktop/Projects/marketing-site', '/projects/other'],
        currentProjectPath: '/Users/me/.worktrees/wrong-name/feature',
        onReorderProjects,
      })
    );

    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
    const [up, down] = getSnapshot();
    expect(matchesContext(up?.when, { kind: 'project', currentProjectName: 'feature' })).toBe(
      false
    );
    expect(matchesContext(down?.when, { kind: 'project', currentProjectName: 'feature' })).toBe(
      true
    );

    await down?.run();
    expect(onReorderProjects).toHaveBeenCalledWith([
      '/projects/other',
      '/Users/me/Desktop/Projects/marketing-site',
    ]);
  });

  it('offers the same move commands for an active worktree family', async () => {
    sessionRegistry.getOrCreate('/projects/alpha-active');
    sessionRegistry.getOrCreate('/projects/beta-active');
    setActiveProjectOrder(['/projects/beta-active', '/projects/alpha-active']);
    renderHook(() =>
      usePinnedProjectCommands({
        pinnedPaths: [],
        currentProjectPath: '/projects/alpha-active',
        onReorderProjects: vi.fn(),
      })
    );

    await waitFor(() => expect(getSnapshot()).toHaveLength(2));
    expect(getSnapshot()[0]?.title).toBe('Move active project up');
    await getSnapshot()[0]?.run();
    expect(getActiveProjectOrder()).toEqual(['/projects/alpha-active', '/projects/beta-active']);
  });
});
