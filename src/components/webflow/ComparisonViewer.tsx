/**
 * The two pages, side by side or on top of each other.
 *
 * A score says how far apart the rebuild is. It cannot say *where*, and where
 * is the only part anyone can act on — so the number is never shown without a
 * way to look at what produced it.
 *
 * Three ways to look, because they answer different questions:
 *
 *   Side by side  — what did the original do here, and what did we do?
 *   Overlay       — a wipe, for judging whether an edge lands in the same place
 *   Difference    — every pixel the comparison counted, painted magenta
 *
 * Both panes scroll together. Comparing two pages that scroll independently is
 * how you convince yourself a section matches when it is four hundred pixels
 * further down.
 */

import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { SegmentedControl } from '../primitives/SegmentedControl';
import type { BreakpointComparison } from '@/lib/webflow';

type ViewMode = 'side-by-side' | 'overlay' | 'difference';

const VIEW_OPTIONS = [
  { value: 'side-by-side' as const, label: 'Side by side', ariaLabel: 'Side by side' },
  { value: 'overlay' as const, label: 'Overlay', ariaLabel: 'Overlay' },
  { value: 'difference' as const, label: 'Difference', ariaLabel: 'Difference' },
];

interface ComparisonViewerProps {
  comparison: BreakpointComparison;
  /** Shown above the panes so it is obvious which width is on screen. */
  templateLabel: string;
}

export function ComparisonViewer({ comparison, templateLabel }: ComparisonViewerProps) {
  const [mode, setMode] = useState<ViewMode>('side-by-side');
  const [wipe, setWipe] = useState(50);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // Guards the scroll handlers against each other: without it, syncing pane B
  // to pane A fires B's own handler, which syncs A back, and the two fight
  // every frame instead of settling.
  const syncing = useRef(false);

  const syncScroll = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const heightDelta = comparison.rebuildHeight - comparison.referenceHeight;

  return (
    <div className="wf-comparison">
      <div className="wf-comparison__bar">
        <div className="wf-comparison__meta">
          <span className="wf-comparison__template">{templateLabel}</span>
          <span className="wf-comparison__width">{comparison.breakpoint}px</span>
          {heightDelta !== 0 && (
            <span className="wf-comparison__delta" title="Full-page height difference">
              {heightDelta > 0 ? '+' : ''}
              {heightDelta}px tall
            </span>
          )}
        </div>
        <SegmentedControl
          aria-label="Comparison view"
          value={mode}
          options={VIEW_OPTIONS}
          onValueChange={(v) => setMode(v)}
        />
      </div>

      {mode === 'side-by-side' && (
        <div className="wf-comparison__panes">
          <figure className="wf-comparison__pane">
            <figcaption className="wf-comparison__caption">Webflow</figcaption>
            <div
              className="wf-comparison__scroll"
              ref={leftRef}
              onScroll={() => syncScroll(leftRef.current, rightRef.current)}
            >
              <img src={`${comparison.dir}/reference.png`} alt="" />
            </div>
          </figure>
          <figure className="wf-comparison__pane">
            <figcaption className="wf-comparison__caption">Rebuild</figcaption>
            <div
              className="wf-comparison__scroll"
              ref={rightRef}
              onScroll={() => syncScroll(rightRef.current, leftRef.current)}
            >
              <img src={`${comparison.dir}/rebuild.png`} alt="" />
            </div>
          </figure>
        </div>
      )}

      {mode === 'overlay' && (
        <div className="wf-comparison__single">
          <div className="wf-comparison__scroll wf-comparison__scroll--wide">
            <div className="wf-overlay">
              <img className="wf-overlay__base" src={`${comparison.dir}/reference.png`} alt="" />
              {/* inline-style-ok: wipe position is a live pointer value */}
              <div className="wf-overlay__clip" style={{ width: `${wipe}%` }}>
                <img src={`${comparison.dir}/rebuild.png`} alt="" />
              </div>
              {/* inline-style-ok: seam tracks the wipe */}
              <div className="wf-overlay__seam" style={{ left: `${wipe}%` }} />
            </div>
          </div>
          <label className="wf-comparison__wipe">
            <span className="wf-comparison__wipe-label">Rebuild</span>
            <input
              type="range"
              min={0}
              max={100}
              value={wipe}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setWipe(Number(e.target.value))}
              aria-label="Wipe between the original and the rebuild"
            />
            <span className="wf-comparison__wipe-label">Webflow</span>
          </label>
        </div>
      )}

      {mode === 'difference' && (
        <div className="wf-comparison__single">
          <div className="wf-comparison__scroll wf-comparison__scroll--wide">
            <img src={`${comparison.dir}/diff.png`} alt="" />
          </div>
          <p className="wf-comparison__legend">
            <span className="wf-comparison__swatch" aria-hidden="true" />
            {comparison.differingPixels.toLocaleString()} pixels differ of{' '}
            {comparison.totalPixels.toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
