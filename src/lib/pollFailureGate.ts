/**
 * When a background poll's failure is worth interrupting someone over.
 *
 * A poll that runs every second is not a user action, and treating each
 * failure as one produces the worst possible behaviour: a single slow round
 * trip — an `osascript` that missed its 2s leash because the machine was busy,
 * a dev server mid-restart — throws a toast in the user's face for something
 * that fixed itself before they finished reading it (issue #930).
 *
 * Silence isn't right either: a poll that has genuinely stopped working should
 * say so. This gate draws the line between the two — tolerate a short run of
 * failures, then surface exactly one report, and reset when the poll recovers
 * so a later outage is reported again.
 *
 * @module lib/pollFailureGate
 */

/** What the caller should do with the failure it just caught. */
export type PollFailureAction =
  /** Too early to tell — log it locally and wait for the next tick. */
  | 'suppress'
  /** Long enough to be real: show the user, once. */
  | 'surface'
  /** Still failing, but already reported for this run. */
  | 'already-surfaced';

export interface PollFailureGate {
  /** Record a failed poll and decide what to do about it. */
  recordFailure(): PollFailureAction;
  /** Record a successful poll, arming the gate for a future outage. */
  recordSuccess(): void;
  /** Consecutive failures since the last success. */
  readonly consecutiveFailures: number;
}

/**
 * @param threshold Consecutive failures tolerated before surfacing one. Must
 * be at least 1; a threshold of 1 surfaces the first failure.
 */
export function createPollFailureGate(threshold: number): PollFailureGate {
  const limit = Number.isFinite(threshold) ? Math.max(1, Math.floor(threshold)) : 1;
  let consecutive = 0;
  let surfaced = false;

  return {
    recordFailure(): PollFailureAction {
      consecutive += 1;
      if (consecutive < limit) return 'suppress';
      if (surfaced) return 'already-surfaced';
      surfaced = true;
      return 'surface';
    },
    recordSuccess(): void {
      consecutive = 0;
      surfaced = false;
    },
    get consecutiveFailures() {
      return consecutive;
    },
  };
}
