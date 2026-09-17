/**
 * The layout menu implementation switch.
 *
 * This is intentionally a tiny, developer-facing seam rather than a feature
 * flag hidden in git history.  Setting `shipstudio.layoutMenuImplementation`
 * to `legacy` in localStorage restores the pre-stacking menu; removing it (or
 * setting it to `new`) uses the spatial editor.  The event makes the switch
 * live while developing without requiring a reload.
 */

export type WorkspaceLayoutMenuImplementation = 'legacy' | 'new';

export const WORKSPACE_LAYOUT_MENU_IMPLEMENTATION_KEY = 'shipstudio.layoutMenuImplementation';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getWorkspaceLayoutMenuImplementation(): WorkspaceLayoutMenuImplementation {
  if (canUseStorage()) {
    const saved = window.localStorage.getItem(WORKSPACE_LAYOUT_MENU_IMPLEMENTATION_KEY);
    if (saved === 'legacy') return 'legacy';
    if (saved === 'new') return 'new';
  }
  return 'new';
}

export function setWorkspaceLayoutMenuImplementation(
  implementation: WorkspaceLayoutMenuImplementation
): void {
  if (canUseStorage()) {
    window.localStorage.setItem(WORKSPACE_LAYOUT_MENU_IMPLEMENTATION_KEY, implementation);
    window.dispatchEvent(new Event('workspace-layout-menu-implementation-change'));
  }
}
