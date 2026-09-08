import { beforeEach, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  TEAM_PANEL_DEFAULT_WIDTH_PX,
  TEAM_PANEL_MAX_WIDTH_PX,
  TEAM_PANEL_MIN_WIDTH_PX,
  useTeamPanelWidth,
} from './useTeamPanelWidth';

/** A slot in a row, so the hook has real geometry to measure against. */
function mountSlot(rowWidth: number, slotLeft: number) {
  const row = document.createElement('div');
  Object.defineProperty(row, 'clientWidth', { value: rowWidth, configurable: true });
  const slot = document.createElement('div');
  slot.getBoundingClientRect = () => ({ left: slotLeft }) as DOMRect;
  row.appendChild(slot);
  document.body.appendChild(row);
  return slot;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

it('starts at the default width when nothing has been stored', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  expect(result.current.width).toBe(TEAM_PANEL_DEFAULT_WIDTH_PX);
});

it('resizes to the pointer distance from the panel edge', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  result.current.slotRef.current = mountSlot(2000, 300);

  act(() => result.current.resize(800));
  expect(result.current.width).toBe(500);
});

it('never lets the panel take more than half the row', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  result.current.slotRef.current = mountSlot(1000, 0);

  // Dragged well past halfway; a panel wider than that makes the preview it is
  // about into the sidebar.
  act(() => result.current.resize(9000));
  expect(result.current.width).toBe(500);
});

it('never shrinks below the width a thread is readable at', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  result.current.slotRef.current = mountSlot(2000, 300);

  act(() => result.current.resize(0));
  expect(result.current.width).toBe(TEAM_PANEL_MIN_WIDTH_PX);
});

it('keeps the width across a reload, and ignores a stored one out of range', () => {
  const { result, unmount } = renderHook(() => useTeamPanelWidth());
  result.current.slotRef.current = mountSlot(2000, 0);
  act(() => result.current.resize(560));
  unmount();

  expect(renderHook(() => useTeamPanelWidth()).result.current.width).toBe(560);

  localStorage.setItem('shipstudio.team.panelDockedWidth', String(TEAM_PANEL_MAX_WIDTH_PX + 400));
  expect(renderHook(() => useTeamPanelWidth()).result.current.width).toBe(
    TEAM_PANEL_DEFAULT_WIDTH_PX
  );
});

it('steps by a delta for keyboard resizing, clamped the same way', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  result.current.slotRef.current = mountSlot(2000, 0);

  act(() => result.current.resizeBy(40));
  expect(result.current.width).toBe(TEAM_PANEL_DEFAULT_WIDTH_PX + 40);

  act(() => result.current.resizeBy(-9000));
  expect(result.current.width).toBe(TEAM_PANEL_MIN_WIDTH_PX);
});

it('survives a slot that is not in the DOM yet rather than throwing', () => {
  const { result } = renderHook(() => useTeamPanelWidth());
  act(() => result.current.resize(600));
  expect(result.current.width).toBe(TEAM_PANEL_DEFAULT_WIDTH_PX);
});
