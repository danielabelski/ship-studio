/**
 * Open state for the CSS Variables panel, owned by the workspace so the header
 * can render its toggle and the palette can reach it.
 *
 * Variables are edited against the live preview, so opening the panel brings
 * the preview forward and starts the dev server — the same thing the comments
 * layer does for the same reason, and the sibling this hook is modelled on
 * (see useWorkspaceComments).
 */
import { useCallback, useState } from 'react';

interface Params {
  isWebProject: boolean;
  workspaceTab: string;
  isPreviewHidden: boolean;
  projectPath: string;
  setIsPreviewHidden: (hidden: boolean) => void;
  setWorkspaceTab: (tab: 'preview' | 'code' | 'branches' | 'prs') => void;
  startDevServer: () => Promise<void> | void;
}

export function useWorkspaceVariablesPanel({
  isWebProject,
  workspaceTab,
  isPreviewHidden,
  projectPath,
  setIsPreviewHidden,
  setWorkspaceTab,
  startDevServer,
}: Params) {
  const [visible, setVisible] = useState(false);

  // The panel edits one project's stylesheets; carrying it across a project
  // switch would show the previous project's variables. Adjusted during render
  // rather than in an effect — React re-runs this render before committing, so
  // the panel is never painted open against the wrong project, and it does not
  // trip the cascading-render that set-state-in-effect exists to catch.
  const [seenPath, setSeenPath] = useState(projectPath);
  if (projectPath !== seenPath) {
    setSeenPath(projectPath);
    setVisible(false);
  }

  const open = isWebProject && workspaceTab === 'preview' && !isPreviewHidden && visible;

  const toggle = useCallback(() => {
    const shouldOpen = !open;
    setVisible(shouldOpen);
    if (!shouldOpen) return;
    setIsPreviewHidden(false);
    setWorkspaceTab('preview');
    void Promise.resolve(startDevServer()).catch(() => undefined);
  }, [open, setIsPreviewHidden, setWorkspaceTab, startDevServer]);

  return { open, setVisible, toggle };
}
