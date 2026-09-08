import { describe, it, expect } from 'vitest';
import { createPollFailureGate } from './pollFailureGate';

describe('createPollFailureGate', () => {
  it('suppresses failures below the threshold', () => {
    const gate = createPollFailureGate(3);
    expect(gate.recordFailure()).toBe('suppress');
    expect(gate.recordFailure()).toBe('suppress');
    expect(gate.consecutiveFailures).toBe(2);
  });

  it('surfaces exactly one report once the threshold is reached', () => {
    const gate = createPollFailureGate(3);
    gate.recordFailure();
    gate.recordFailure();
    expect(gate.recordFailure()).toBe('surface');
    expect(gate.recordFailure()).toBe('already-surfaced');
    expect(gate.recordFailure()).toBe('already-surfaced');
  });

  it('rearms after a success, so a later outage is reported again', () => {
    const gate = createPollFailureGate(2);
    gate.recordFailure();
    expect(gate.recordFailure()).toBe('surface');

    gate.recordSuccess();
    expect(gate.consecutiveFailures).toBe(0);

    expect(gate.recordFailure()).toBe('suppress');
    expect(gate.recordFailure()).toBe('surface');
  });

  it('forgets a partial run of failures on success', () => {
    const gate = createPollFailureGate(3);
    gate.recordFailure();
    gate.recordFailure();
    gate.recordSuccess();
    expect(gate.recordFailure()).toBe('suppress');
    expect(gate.consecutiveFailures).toBe(1);
  });

  it('surfaces immediately at a threshold of one', () => {
    const gate = createPollFailureGate(1);
    expect(gate.recordFailure()).toBe('surface');
    expect(gate.recordFailure()).toBe('already-surfaced');
  });

  it('treats a nonsensical threshold as one rather than never reporting', () => {
    for (const threshold of [0, -5, 0.4, Number.NaN]) {
      const gate = createPollFailureGate(threshold);
      expect(gate.recordFailure()).toBe('surface');
    }
  });
});
