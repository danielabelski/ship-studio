/**
 * Hook for workspace layout state management.
 *
 * Manages: log panel visibility, preview visibility, and the workspace tab
 * selector (preview/code/branches/prs). The narrow-window compact layout is a
 * separate tree driven by `useIsCompact`; its state lives in CompactWorkspace,
 * not here.
 */

import { useState, useCallback, useEffect } from 'react';
import { trackPageview } from '../lib/analytics';

interface UseWorkspaceLayoutParams {
  /** Whether GitHub is connected for the current project */
  isGitHubConnected: boolean;
  /**
   * Whether the branches tab has anything to show — true for any project with
   * a remote, GitHub or not.
   *
   * Branch management is plain git. Gating it on GitHub meant a GitLab project
   * selecting "Branches" was silently returned to the preview tab, with no way
   * to reach its own branches. Defaults to `isGitHubConnected`, so a caller
   * that doesn't pass it keeps the old behaviour.
   */
  canManageBranches?: boolean;
}

type WorkspaceTab = 'preview' | 'code' | 'branches' | 'prs';

const TAB_SCREEN: Record<WorkspaceTab, string> = {
  preview: 'Workspace - Preview',
  code: 'Workspace - Code',
  branches: 'Workspace - Branches',
  prs: 'Workspace - Pull Requests',
};

export function useWorkspaceLayout({
  isGitHubConnected,
  canManageBranches,
}: UseWorkspaceLayoutParams) {
  const branchesAvailable = canManageBranches ?? isGitHubConnected;
  // Health-logs panel visibility (takes over the terminal pane when the user
  // opens the code-health log feed).
  const [showHealthLogs, setShowHealthLogs] = useState(false);

  // Preview panel visibility
  const [isPreviewHidden, setIsPreviewHidden] = useState(false);

  // Workspace tab state (preview/code/branches/prs). The raw value is what the
  // user selected; `workspaceTab` below projects each of branches/prs through
  // its own gate and falls back to preview when that tab can't apply. We keep
  // the raw value so the user's last selection comes back on reconnect.
  const [workspaceTabRaw, setWorkspaceTabRaw] = useState<WorkspaceTab>('preview');

  // Tab switches are recorded as the `$pageview` below, not as a separate
  // click event — one screen change, one event.
  const setWorkspaceTab = setWorkspaceTabRaw;

  // Branches needs a repo; pull requests need GitHub specifically. Collapsing
  // the two sent GitLab projects to preview when they asked for branches.
  const tabUnavailable =
    (workspaceTabRaw === 'branches' && !branchesAvailable) ||
    (workspaceTabRaw === 'prs' && !isGitHubConnected);

  const workspaceTab: WorkspaceTab = tabUnavailable ? 'preview' : workspaceTabRaw;

  // Pageview tracks the *projected* tab (after the availability gates),
  // so a forced fallback when GitHub disconnects is recorded as a screen
  // change. Also fires once on mount with the initial resolved tab — replaces
  // the seed previously fired from useProjectLifecycle.
  useEffect(() => {
    trackPageview(TAB_SCREEN[workspaceTab]);
  }, [workspaceTab]);

  // Reset layout state (when going back to projects)
  const resetLayout = useCallback(() => {
    setShowHealthLogs(false);
  }, []);

  return {
    // Log panel
    showHealthLogs,
    setShowHealthLogs,

    // Preview
    isPreviewHidden,
    setIsPreviewHidden,

    // Tabs
    workspaceTab,
    setWorkspaceTab,

    // Reset
    resetLayout,
  };
}
