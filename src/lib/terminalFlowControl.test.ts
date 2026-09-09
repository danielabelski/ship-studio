import { describe, it, expect, vi } from 'vitest';
import {
  createTerminalFlowControl,
  HIGH_WATER_BYTES,
  LOW_WATER_BYTES,
  type FlowControlledTerminal,
} from './terminalFlowControl';

/** An xterm stand-in whose parse acknowledgements we control by hand. */
function fakeTerm() {
  const pending: Array<() => void> = [];
  const written: Array<string | Uint8Array> = [];
  const term: FlowControlledTerminal = {
    write(data, callback) {
      written.push(data);
      if (callback) pending.push(callback);
    },
  };
  return {
    term,
    written,
    /** Acknowledge the oldest `n` outstanding writes, oldest first. */
    ack(n = pending.length) {
      pending.splice(0, n).forEach((cb) => cb());
    },
    get outstanding() {
      return pending.length;
    },
  };
}

const chunk = (bytes: number) => new Uint8Array(bytes);

describe('createTerminalFlowControl', () => {
  it('passes data straight through when the parser keeps up', () => {
    const f = fakeTerm();
    const onPause = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause, onResume: vi.fn() });

    flow.write(chunk(1000));
    f.ack();
    flow.write(chunk(1000));
    f.ack();

    expect(f.written).toHaveLength(2);
    expect(flow.backlog).toBe(0);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('pauses the producer once the unparsed backlog crosses the high mark', () => {
    const f = fakeTerm();
    const onPause = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause, onResume: vi.fn() });

    // Nothing is acknowledged: this is a producer outrunning the parser.
    flow.write(chunk(HIGH_WATER_BYTES - 1));
    expect(onPause).not.toHaveBeenCalled();

    flow.write(chunk(1));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(flow.paused).toBe(true);
  });

  it('keeps writing while paused — pausing is upstream, not a drop', () => {
    const f = fakeTerm();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume: vi.fn() });

    flow.write(chunk(HIGH_WATER_BYTES));
    flow.write(chunk(64));

    expect(f.written).toHaveLength(2);
    expect(flow.backlog).toBe(HIGH_WATER_BYTES + 64);
  });

  it('does not re-pause on every chunk while already paused', () => {
    const f = fakeTerm();
    const onPause = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause, onResume: vi.fn() });

    flow.write(chunk(HIGH_WATER_BYTES));
    flow.write(chunk(HIGH_WATER_BYTES));
    flow.write(chunk(HIGH_WATER_BYTES));

    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('resumes once the backlog drains to the low mark', () => {
    const f = fakeTerm();
    const onResume = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume });

    flow.write(chunk(HIGH_WATER_BYTES));
    flow.write(chunk(LOW_WATER_BYTES));
    expect(flow.paused).toBe(true);

    f.ack(1); // the big chunk parses; LOW_WATER_BYTES is still outstanding
    expect(flow.backlog).toBe(LOW_WATER_BYTES);
    expect(flow.paused).toBe(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('stays paused while the backlog sits between the marks', () => {
    const f = fakeTerm();
    const onResume = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume });

    flow.write(chunk(HIGH_WATER_BYTES));
    flow.write(chunk(LOW_WATER_BYTES + 1));
    expect(flow.paused).toBe(true);

    f.ack(1); // still above the low mark by one byte — hold
    expect(flow.backlog).toBe(LOW_WATER_BYTES + 1);
    expect(flow.paused).toBe(true);
    expect(onResume).not.toHaveBeenCalled();

    f.ack(1);
    expect(flow.paused).toBe(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('ignores acknowledgements that arrive after disposal', () => {
    const f = fakeTerm();
    const onResume = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume });

    flow.write(chunk(HIGH_WATER_BYTES));
    flow.dispose();
    expect(onResume).toHaveBeenCalledTimes(1); // released on teardown

    f.ack();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(flow.backlog).toBe(0);
  });

  it('releases a held producer on disposal so no PTY is left paused', () => {
    const f = fakeTerm();
    const onResume = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume });

    flow.write(chunk(HIGH_WATER_BYTES));
    expect(flow.paused).toBe(true);

    flow.dispose();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(flow.paused).toBe(false);
  });

  it('does not call onResume on disposal when nothing was paused', () => {
    const f = fakeTerm();
    const onResume = vi.fn();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume });

    flow.write(chunk(10));
    flow.dispose();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('drops writes after disposal instead of reviving the accounting', () => {
    const f = fakeTerm();
    const flow = createTerminalFlowControl(f.term, { onPause: vi.fn(), onResume: vi.fn() });

    flow.dispose();
    flow.write(chunk(100));

    expect(f.written).toHaveLength(0);
    expect(flow.backlog).toBe(0);
  });

  it('survives a duplicated acknowledgement without wedging the pause', () => {
    const f = fakeTerm();
    const onPause = vi.fn();
    const flow = createTerminalFlowControl(f.term, {
      onPause,
      onResume: vi.fn(),
      highWater: 100,
      lowWater: 10,
    });

    flow.write(chunk(50));
    f.ack();
    f.ack(); // no-op: nothing outstanding
    expect(flow.backlog).toBe(0);

    flow.write(chunk(100));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('accounts for strings by length', () => {
    const f = fakeTerm();
    const flow = createTerminalFlowControl(f.term, {
      onPause: vi.fn(),
      onResume: vi.fn(),
      highWater: 10,
      lowWater: 2,
    });

    flow.write('abcdefghij');
    expect(flow.paused).toBe(true);
  });
});
