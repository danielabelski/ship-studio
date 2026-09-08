import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceLayout } from './useWorkspaceLayout';

describe('useWorkspaceLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useWorkspaceLayout({ isGitHubConnected: false }));

    expect(result.current.showHealthLogs).toBe(false);
    expect(result.current.isPreviewHidden).toBe(false);
    expect(result.current.workspaceTab).toBe('preview');
  });

  it('switches workspace tabs', () => {
    const { result } = renderHook(() => useWorkspaceLayout({ isGitHubConnected: true }));

    act(() => {
      result.current.setWorkspaceTab('branches');
    });
    expect(result.current.workspaceTab).toBe('branches');

    act(() => {
      result.current.setWorkspaceTab('prs');
    });
    expect(result.current.workspaceTab).toBe('prs');
  });

  it('projects workspaceTab to preview when GitHub disconnects', () => {
    const { result, rerender } = renderHook(
      ({ connected }) => useWorkspaceLayout({ isGitHubConnected: connected }),
      { initialProps: { connected: true } }
    );

    act(() => {
      result.current.setWorkspaceTab('branches');
    });
    expect(result.current.workspaceTab).toBe('branches');

    rerender({ connected: false });

    // Disconnected → the derived view falls back to preview
    expect(result.current.workspaceTab).toBe('preview');

    // Reconnect — the user's original selection comes back (state was preserved)
    rerender({ connected: true });
    expect(result.current.workspaceTab).toBe('branches');
  });

  it('does not reset preview tab when GitHub disconnects if already on preview', () => {
    const { result, rerender } = renderHook(
      ({ connected }) => useWorkspaceLayout({ isGitHubConnected: connected }),
      { initialProps: { connected: true } }
    );

    rerender({ connected: false });

    expect(result.current.workspaceTab).toBe('preview');
  });

  it('resets layout clears log panels', () => {
    const { result } = renderHook(() => useWorkspaceLayout({ isGitHubConnected: false }));

    act(() => {
      result.current.setShowHealthLogs(true);
    });

    act(() => {
      result.current.resetLayout();
    });

    expect(result.current.showHealthLogs).toBe(false);
  });

  it('toggles preview visibility', () => {
    const { result } = renderHook(() => useWorkspaceLayout({ isGitHubConnected: false }));

    act(() => {
      result.current.setIsPreviewHidden(true);
    });
    expect(result.current.isPreviewHidden).toBe(true);
  });

  // A GitLab project is not a GitHub project, but it does have branches.
  describe('a remote that is not GitHub', () => {
    const gitlabProject = { isGitHubConnected: false, canManageBranches: true };

    it('can still reach its branches', () => {
      const { result } = renderHook(() => useWorkspaceLayout(gitlabProject));

      act(() => {
        result.current.setWorkspaceTab('branches');
      });

      // Before this, branches was projected to preview whenever GitHub was
      // absent, so the tab could not be opened at all.
      expect(result.current.workspaceTab).toBe('branches');
    });

    it('still cannot reach pull requests, which are GitHub-only', () => {
      const { result } = renderHook(() => useWorkspaceLayout(gitlabProject));

      act(() => {
        result.current.setWorkspaceTab('prs');
      });

      expect(result.current.workspaceTab).toBe('preview');
    });
  });

  it('keeps the old behaviour when canManageBranches is not passed', () => {
    const { result } = renderHook(() => useWorkspaceLayout({ isGitHubConnected: false }));

    act(() => {
      result.current.setWorkspaceTab('branches');
    });

    expect(result.current.workspaceTab).toBe('preview');
  });
});
