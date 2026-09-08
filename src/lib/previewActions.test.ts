/**
 * The agent's action channel must reach exactly one preview frame.
 *
 * On the breakpoint canvas four preview frames are live at once. Before this
 * was scoped, one `preview_click` was delivered to all four: the page was
 * clicked four times, passive frames navigated independently of the host's
 * idea of where the preview is, and the result resolved from whichever frame
 * answered first — so the rect the agent cursor flew to, and the match count
 * it reported, could describe a frame the user was not even in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execPreviewAction } from './previewActions';
import { setInspectSource } from './inspectStore';

type PostSpy = ReturnType<typeof vi.fn>;

/** A stand-in for a preview iframe's contentWindow that records its posts. */
const makeFrame = (): { win: Window; post: PostSpy } => {
  const post = vi.fn();
  const win = { postMessage: post } as unknown as Window;
  return { win, post };
};

/** Mount `count` iframes whose contentWindow is a recording stub. */
const mountFrames = (count: number): { win: Window; post: PostSpy }[] => {
  const frames = Array.from({ length: count }, () => makeFrame());
  frames.forEach((frame) => {
    const el = document.createElement('iframe');
    document.body.appendChild(el);
    Object.defineProperty(el, 'contentWindow', { value: frame.win, configurable: true });
  });
  return frames;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  setInspectSource(null);
  vi.useRealTimers();
});

describe('execPreviewAction targeting', () => {
  it('sends to only the pinned frame when the canvas has an active frame', async () => {
    const frames = mountFrames(4);
    setInspectSource(frames[2].win);

    const pending = execPreviewAction({ action: 'click', selector: 'a' });
    vi.advanceTimersByTime(6000);
    await pending;

    expect(frames[2].post).toHaveBeenCalledTimes(1);
    expect(frames[2].post.mock.calls[0][0]).toMatchObject({
      source: 'shipstudio-inspect-host',
      type: 'exec-action',
      action: 'click',
      selector: 'a',
    });
    for (const other of [frames[0], frames[1], frames[3]]) {
      expect(other.post).not.toHaveBeenCalled();
    }
  });

  it('broadcasts in focus mode, where there is only one preview frame', async () => {
    const frames = mountFrames(2);
    setInspectSource(null);

    const pending = execPreviewAction({ action: 'scroll', to: 'bottom' });
    vi.advanceTimersByTime(6000);
    await pending;

    expect(frames[0].post).toHaveBeenCalledTimes(1);
    expect(frames[1].post).toHaveBeenCalledTimes(1);
  });

  it('resolves with an agent-readable answer when the frame never replies', async () => {
    mountFrames(1);
    const pending = execPreviewAction({ action: 'click', selector: 'a' });
    vi.advanceTimersByTime(6000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('did not respond');
  });

  it('resolves from the pinned frame’s reply', async () => {
    const frames = mountFrames(3);
    setInspectSource(frames[0].win);

    const pending = execPreviewAction({ action: 'click', selector: 'button' });
    const sent = frames[0].post.mock.calls[0][0] as { id: string };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'shipstudio-inspect',
          type: 'action-result',
          id: sent.id,
          ok: true,
          data: { clicked: 'button', matches: 1 },
          rect: { x: 0, y: 0, w: 10, h: 10, fx: 0.5, fy: 0.25 },
        },
      })
    );
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.rect?.fy).toBe(0.25);
  });
});
