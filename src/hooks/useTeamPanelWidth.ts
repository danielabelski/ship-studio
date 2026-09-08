/**
 * How wide the pinned Team panel is, and remembering it.
 *
 * Pinned, the panel takes a column out of the workspace, so its width is the
 * user's business rather than a constant — a column sized for a comment list is
 * not the column you want while reading a thread. Same arrangement the docked
 * Variables and element-tree panels use: the panel owns a number, the shared
 * `PanelResizeHandle` turns a pointer position into it, and it survives a
 * reload in localStorage.
 *
 * @module hooks/useTeamPanelWidth
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'shipstudio.team.panelDockedWidth';

/** Narrow enough to be worth pinning; wide enough for a thread to be readable. */
export const TEAM_PANEL_MIN_WIDTH_PX = 320;
export const TEAM_PANEL_MAX_WIDTH_PX = 720;
export const TEAM_PANEL_DEFAULT_WIDTH_PX = 420;

function readStoredWidth(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) &&
      saved >= TEAM_PANEL_MIN_WIDTH_PX &&
      saved <= TEAM_PANEL_MAX_WIDTH_PX
      ? saved
      : TEAM_PANEL_DEFAULT_WIDTH_PX;
  } catch {
    return TEAM_PANEL_DEFAULT_WIDTH_PX;
  }
}

export function useTeamPanelWidth() {
  const [width, setWidth] = useState(readStoredWidth);
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // A rejected write costs the remembered width, never the resize.
    }
  }, [width]);

  /**
   * The most the panel may take.
   *
   * Never more than half the row: past that the panel is the workspace and the
   * preview it is about is the sidebar.
   */
  const clampToRow = useCallback((next: number) => {
    const row = slotRef.current?.parentElement?.clientWidth ?? 0;
    const ceiling = row > 0 ? Math.min(TEAM_PANEL_MAX_WIDTH_PX, row / 2) : TEAM_PANEL_MAX_WIDTH_PX;
    return Math.max(TEAM_PANEL_MIN_WIDTH_PX, Math.min(next, ceiling));
  }, []);

  // The panel is the leftmost column, so its width is the pointer's distance
  // from its own left edge — measured live, because the row can move.
  const resize = useCallback(
    (clientX: number) => {
      const slot = slotRef.current;
      if (!slot) return;
      setWidth(clampToRow(clientX - slot.getBoundingClientRect().left));
    },
    [clampToRow]
  );

  const resizeBy = useCallback(
    (delta: number) => setWidth((current) => clampToRow(current + delta)),
    [clampToRow]
  );

  return { width, slotRef, resize, resizeBy };
}
