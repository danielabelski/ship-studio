import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT } from '../lib/settings';
import { useElementBreadcrumbVisibility } from './useElementBreadcrumbVisibility';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('useElementBreadcrumbVisibility', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(true);
  });

  it('loads the persisted preference and responds to live setting changes', async () => {
    const { result } = renderHook(() => useElementBreadcrumbVisibility());

    await waitFor(() => expect(result.current[0]).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('get_element_breadcrumb_enabled');

    act(() => {
      window.dispatchEvent(
        new CustomEvent<boolean>(ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT, { detail: false })
      );
    });

    expect(result.current[0]).toBe(false);
  });

  it('does not let the initial read undo a toggle made while it was in flight', async () => {
    // The read is fired on mount; the user can reach Settings before it lands.
    // Applying the older answer puts the setting back on, which reads as the
    // toggle not working. (CodeRabbit flagged this on #904.)
    let resolveRead: (value: boolean) => void = () => {};
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'get_element_breadcrumb_enabled'
        ? new Promise<boolean>((resolve) => {
            resolveRead = resolve;
          })
        : Promise.resolve(undefined)
    );

    const { result } = renderHook(() => useElementBreadcrumbVisibility());

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    // The stale read finally answers with the value from before the toggle.
    await act(async () => {
      resolveRead(true);
      // Let the `.then` on the read run before asserting.
      await Promise.resolve();
    });

    expect(result.current[0]).toBe(false);
  });

  it('does not let the initial read undo a change that arrived by event', async () => {
    let resolveRead: (value: boolean) => void = () => {};
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'get_element_breadcrumb_enabled'
        ? new Promise<boolean>((resolve) => {
            resolveRead = resolve;
          })
        : Promise.resolve(undefined)
    );

    const { result } = renderHook(() => useElementBreadcrumbVisibility());

    act(() => {
      window.dispatchEvent(
        new CustomEvent<boolean>(ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT, { detail: false })
      );
    });
    expect(result.current[0]).toBe(false);

    await act(async () => {
      resolveRead(true);
      // Let the `.then` on the read run before asserting.
      await Promise.resolve();
    });

    expect(result.current[0]).toBe(false);
  });

  it('updates the local value and persists changes', async () => {
    const { result } = renderHook(() => useElementBreadcrumbVisibility());

    await waitFor(() => expect(result.current[0]).toBe(true));

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('set_element_breadcrumb_enabled', { enabled: false })
    );
  });
});
