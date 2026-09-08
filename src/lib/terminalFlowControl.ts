/**
 * Backpressure between a PTY and the xterm instance rendering it.
 *
 * `Terminal.write()` does not render synchronously: it appends to an internal
 * buffer and parses on a frame budget. Hand it data faster than it can parse —
 * a verbose agent turn, a build that logs every file, a runaway `yes` — and
 * that buffer grows without bound until xterm gives up at ~50 MB with "write
 * data discarded, use flow control to avoid losing data", having thrown away
 * output the user needed (issue #910).
 *
 * xterm's documented remedy is the write callback: it fires once a chunk has
 * actually been parsed, so the difference between bytes written and bytes
 * acknowledged is the live backlog. This module tracks that number and asks
 * the producer to stop above {@link HIGH_WATER_BYTES} and start again below
 * {@link LOW_WATER_BYTES}. Nothing is dropped and nothing is queued on the
 * heap — the pause propagates all the way down to the child's own `write`.
 *
 * @module lib/terminalFlowControl
 */

/**
 * Backlog at which the producer is asked to stop. Roughly a screenful of a
 * dense TUI repaint; high enough that ordinary bursty output never pauses,
 * low enough that the buffer stays three orders of magnitude below xterm's
 * discard threshold.
 */
export const HIGH_WATER_BYTES = 1024 * 1024;

/**
 * Backlog at which the producer is allowed to resume. Well below the high
 * mark so a steady fast producer toggles occasionally rather than on every
 * chunk.
 */
export const LOW_WATER_BYTES = 256 * 1024;

/** The part of xterm's Terminal this module needs. */
export interface FlowControlledTerminal {
  write(data: string | Uint8Array, callback?: () => void): void;
}

export interface TerminalFlowControlOptions {
  /** Called when the backlog crosses the high-water mark. */
  onPause: () => void;
  /** Called when the backlog falls back below the low-water mark. */
  onResume: () => void;
  highWater?: number;
  lowWater?: number;
}

export interface TerminalFlowControl {
  /** Write a chunk, accounting for its size until xterm acknowledges it. */
  write(data: string | Uint8Array): void;
  /** Bytes handed to xterm that it has not finished parsing. */
  readonly backlog: number;
  /** Whether the producer is currently asked to hold. */
  readonly paused: boolean;
  /**
   * Stop accounting. Any acknowledgement that arrives afterwards is ignored,
   * and a held producer is released — a terminal being torn down must never
   * leave its PTY paused.
   */
  dispose(): void;
}

/**
 * Wrap a terminal so every write is accounted for and the producer is paced.
 *
 * `onPause`/`onResume` are only ever called on a transition, never repeatedly
 * at the same level, so they can be wired straight to an IPC call.
 */
export function createTerminalFlowControl(
  term: FlowControlledTerminal,
  { onPause, onResume, highWater, lowWater }: TerminalFlowControlOptions
): TerminalFlowControl {
  const high = highWater ?? HIGH_WATER_BYTES;
  const low = lowWater ?? LOW_WATER_BYTES;
  let backlog = 0;
  let paused = false;
  let disposed = false;

  const acknowledge = (size: number) => {
    if (disposed) return;
    // Never let the counter drift negative if xterm double-fires a callback:
    // a negative backlog would make the terminal un-pausable for the rest of
    // the session.
    backlog = Math.max(0, backlog - size);
    if (paused && backlog <= low) {
      paused = false;
      onResume();
    }
  };

  return {
    write(data: string | Uint8Array): void {
      if (disposed) return;
      // Bytes, not code units: xterm buffers the decoded UTF-8 either way,
      // and PTY data arrives as Uint8Array in every hot path here.
      const size = typeof data === 'string' ? data.length : data.byteLength;
      backlog += size;
      term.write(data, () => acknowledge(size));
      if (!paused && backlog >= high) {
        paused = true;
        onPause();
      }
    },
    get backlog() {
      return backlog;
    },
    get paused() {
      return paused;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      backlog = 0;
      if (paused) {
        paused = false;
        onResume();
      }
    },
  };
}
