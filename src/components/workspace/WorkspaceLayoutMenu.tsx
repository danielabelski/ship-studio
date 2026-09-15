/**
 * Panel Layout menu entry point.
 *
 * The old flat menu remains a real, selectable implementation in
 * `WorkspaceLayoutMenuLegacy.tsx`. Developers can switch it on with:
 *
 *     localStorage.setItem('shipstudio.layoutMenuImplementation', 'legacy')
 *
 * The default is the spatial editor. Keeping the switch here means either
 * implementation can be evaluated in the running app without reconstructing
 * the previous UI from git.
 */

import { useEffect, useState } from 'react';
import { WorkspaceLayoutMenuLegacy } from './WorkspaceLayoutMenuLegacy';
import { WorkspaceLayoutMenuNew } from './WorkspaceLayoutMenuNew';
import {
  getWorkspaceLayoutMenuImplementation,
  type WorkspaceLayoutMenuImplementation,
} from './WorkspaceLayoutMenuMode';

export function WorkspaceLayoutMenu() {
  const [implementation, setImplementation] = useState<WorkspaceLayoutMenuImplementation>(() =>
    getWorkspaceLayoutMenuImplementation()
  );

  useEffect(() => {
    const handleChange = () => setImplementation(getWorkspaceLayoutMenuImplementation());
    window.addEventListener('workspace-layout-menu-implementation-change', handleChange);
    return () =>
      window.removeEventListener('workspace-layout-menu-implementation-change', handleChange);
  }, []);

  return implementation === 'legacy' ? <WorkspaceLayoutMenuLegacy /> : <WorkspaceLayoutMenuNew />;
}
