/**
 * Request/response channel to the inspector shim's action executor
 * (`exec-action` in src-tauri/src/webview_scripts.rs): real clicks, typing,
 * scrolling, and element queries inside the preview page, on behalf of the
 * agent preview bridge.
 *
 * The request goes to ONE frame: the active one the inspector is pinned to
 * (`getInspectSource`), or — in focus mode, where the store has no pin because
 * there is only ever one preview frame — every preview iframe. Broadcasting
 * unconditionally was fine while "every preview iframe" meant one; on the
 * breakpoint canvas it meant a single `preview_click` clicked in all four
 * frames, navigated four pages independently of the host's idea of where the
 * preview is, and then resolved from whichever frame answered first — so the
 * rect and match count could describe a frame the user was not in.
 *
 * Responses still match on a unique request id.
 */

import { getInspectSource } from './inspectStore';

const HOST_CHANNEL = 'shipstudio-inspect-host';
const SHIM_CHANNEL = 'shipstudio-inspect';

export interface PreviewActionRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Center of the target as fractions of the preview viewport (0..1). */
  fx: number;
  fy: number;
}

export interface PreviewActionResult {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
  rect?: PreviewActionRect;
}

export type PreviewAction =
  | { action: 'click'; selector: string; text?: string; index?: number }
  | {
      action: 'type';
      selector: string;
      value: string;
      text?: string;
      index?: number;
      submit?: boolean;
    }
  | { action: 'scroll'; selector?: string; text?: string; to?: 'top' | 'bottom'; y?: number }
  | { action: 'query'; selector: string; text?: string };

let nextActionId = 0;

/**
 * Execute an action in the preview page and wait for the shim's answer.
 * Resolves (never rejects) with an `ok: false` result on timeout so callers
 * always get an agent-readable explanation.
 */
export function execPreviewAction(
  action: PreviewAction,
  timeoutMs = 6000
): Promise<PreviewActionResult> {
  return new Promise((resolve) => {
    const id = `agent-act-${++nextActionId}`;

    const finish = (result: PreviewActionResult) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const d = event.data as {
        source?: string;
        type?: string;
        id?: string;
        ok?: boolean;
        error?: string;
        data?: Record<string, unknown>;
        rect?: PreviewActionRect;
      } | null;
      if (!d || typeof d !== 'object') return;
      if (d.source !== SHIM_CHANNEL || d.type !== 'action-result' || d.id !== id) return;
      finish({ ok: d.ok === true, error: d.error, data: d.data, rect: d.rect });
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error:
          'The preview page did not respond to the action within ' +
          `${Math.round(timeoutMs / 1000)}s. The preview may still be loading, ` +
          'the dev server may be down, or the preview panel may not be open.',
      });
    }, timeoutMs);

    window.addEventListener('message', onMessage);

    const message = { source: HOST_CHANNEL, type: 'exec-action', id, ...action };
    const target = getInspectSource();
    if (target) {
      try {
        target.postMessage(message, '*');
      } catch {
        // The frame went away between selection and send; the timeout below
        // turns that into an agent-readable answer.
      }
      return;
    }
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(message, '*');
      } catch {
        // Cross-origin frames that refuse postMessage are not the preview.
      }
    });
  });
}
