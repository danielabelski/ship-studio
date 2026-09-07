/**
 * Fixtures that fail.
 *
 * A good number of this app's surfaces are only reachable through a failed
 * call — the merge-conflict panel opens when `pull_and_merge` rejects with a
 * `MERGE_CONFLICT:` message, not when anything succeeds. A fixture layer that
 * can only resolve therefore cannot reach them at all, which quietly limits
 * the harness to the happy path of every feature.
 *
 * The router already invokes function fixtures, so a throwing handler works;
 * this exists so a scenario says what it means and so the capability is
 * discoverable rather than folklore.
 */

/**
 * Reject with a message. `asCommandError` (src/lib/errors.ts) coerces a thrown
 * `Error` to `{ type: 'Other', message }`, which is what the substring checks
 * in the app's error handling actually read.
 */
export function rejectsWith(message: string) {
  return () => {
    throw new Error(message);
  };
}

/**
 * A call that never comes back.
 *
 * The other half of the same gap: a surface that only exists *while* a command
 * is in flight — "Saving…", "Loading your Vercel projects…" — cannot be
 * photographed with a fixture that resolves, because it is gone by the time the
 * page settles. A pending promise holds the UI in that state, and IPC still
 * falls quiet (nothing new is being asked for), so the capture settles
 * normally.
 */
export function neverAnswers() {
  return () => new Promise<never>(() => {});
}
