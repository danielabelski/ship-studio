import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWindowFocused, isWindowFocused } from './useWindowFocused';

function setWindowState({ visible, hasFocus }: { visible: boolean; hasFocus: boolean }) {
  Object.defineProperty(document, 'visibilityState', {
    value: visible ? 'visible' : 'hidden',
    configurable: true,
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(hasFocus);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isWindowFocused', () => {
  it('is true only when the window is both visible and focused', () => {
    setWindowState({ visible: true, hasFocus: true });
    expect(isWindowFocused()).toBe(true);

    // Visible but behind another window: focus alone would miss this.
    setWindowState({ visible: true, hasFocus: false });
    expect(isWindowFocused()).toBe(false);

    // Minimised or on another Space: visibility alone would miss this.
    setWindowState({ visible: false, hasFocus: true });
    expect(isWindowFocused()).toBe(false);
  });
});

describe('useWindowFocused', () => {
  it('starts from the current state', () => {
    setWindowState({ visible: true, hasFocus: true });
    const { result } = renderHook(() => useWindowFocused());
    expect(result.current).toBe(true);
  });

  it('goes false when the window is blurred, and true again on focus', () => {
    setWindowState({ visible: true, hasFocus: true });
    const { result } = renderHook(() => useWindowFocused());

    act(() => {
      setWindowState({ visible: true, hasFocus: false });
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setWindowState({ visible: true, hasFocus: true });
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe(true);
  });

  it('follows visibility changes as well as focus', () => {
    setWindowState({ visible: true, hasFocus: true });
    const { result } = renderHook(() => useWindowFocused());

    act(() => {
      setWindowState({ visible: false, hasFocus: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
  });

  it('removes its listeners on unmount', () => {
    setWindowState({ visible: true, hasFocus: true });
    const remove = vi.spyOn(window, 'removeEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useWindowFocused());

    unmount();

    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
