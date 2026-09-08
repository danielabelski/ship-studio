/**
 * Fidelity — the panel that makes "it still looks like the site" checkable.
 *
 * The old `webflow-to-code` plugin ended at a markdown brief. Nothing in it
 * ever compared the result to the original, which meant the one property a
 * migration is judged on was the one property nobody measured. This panel is
 * the other end of that: a number per template per breakpoint, the picture
 * that produced each number, and the record of the loop that moved them.
 *
 * The loop it reports on is:
 *
 *     build → compare → fix → compare → …
 *
 * and the agent drives it. The panel is where a person checks on it, decides
 * the remaining gap is acceptable, or spots that the fix at 1440 broke 767.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../primitives/Button';
import { Spinner } from '../primitives/Spinner';
import { ComparisonViewer } from './ComparisonViewer';
import { FidelityMatrix } from './FidelityMatrix';
import { useAsyncState } from '@/hooks/useAsyncState';
import {
  fidelityBand,
  FIDELITY_BAND_LABEL,
  loadFidelityRun,
  runScore,
  type FidelityRun,
} from '@/lib/webflow';

interface FidelityPanelProps {
  /** Directory the capture wrote to. Becomes a project path once this is native. */
  source: string;
}

export function FidelityPanel({ source }: FidelityPanelProps) {
  const {
    data: run,
    isLoading,
    error,
    execute,
  } = useAsyncState<FidelityRun, [string]>(loadFidelityRun);
  const [selected, setSelected] = useState<{ template: string; breakpoint: number } | null>(null);

  useEffect(() => {
    void execute(source).then((loaded) => {
      if (!loaded) return;
      // Open on the worst cell rather than on nothing. The panel's job is to
      // show where the rebuild is wrong, and making someone hunt for that in a
      // grid before they see anything buries the finding under a chore.
      const worst = loaded.templates
        .flatMap((t) => (t.status === 'compared' ? t.breakpoints.map((b) => ({ t, b })) : []))
        .sort((x, y) => x.b.score - y.b.score)[0];
      if (worst) {
        setSelected({ template: worst.t.template, breakpoint: worst.b.breakpoint });
      }
    });
  }, [execute, source]);

  // Widest first — the order Webflow lists its own breakpoints in, so the
  // column headings read the way the person authoring the site is used to.
  const breakpoints = useMemo(() => {
    const all = new Set<number>();
    run?.templates.forEach((t) => {
      if (t.status === 'compared') t.breakpoints.forEach((b) => all.add(b.breakpoint));
    });
    return [...all].sort((a, b) => b - a);
  }, [run]);

  const comparison = useMemo(() => {
    if (!run || !selected) return null;
    const template = run.templates.find((t) => t.template === selected.template);
    if (template?.status !== 'compared') return null;
    return template.breakpoints.find((b) => b.breakpoint === selected.breakpoint) ?? null;
  }, [run, selected]);

  if (isLoading) {
    return (
      <div className="wf-panel wf-panel--centred">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="wf-panel wf-panel--centred">
        <p className="wf-panel__empty">
          No comparison has been run yet.
          <br />
          <span className="wf-panel__empty-detail">
            Run <code>scripts/webflow-fidelity.mjs</code> against the original and this project.
          </span>
        </p>
      </div>
    );
  }

  const overall = runScore(run);
  const band = overall === null ? null : fidelityBand(overall);

  return (
    <div className="wf-panel">
      <header className="wf-panel__header">
        <div className="wf-panel__score-block">
          {overall === null ? (
            <span className="wf-panel__no-score">Not compared</span>
          ) : (
            <>
              <span className={`wf-panel__score wf-panel__score--${band}`}>
                {overall.toFixed(1)}
                <span className="wf-panel__score-unit">%</span>
              </span>
              <span className="wf-panel__band">{band && FIDELITY_BAND_LABEL[band]}</span>
            </>
          )}
          {/* Worst, not mean. An average across breakpoints is exactly the
              statistic that hides a broken phone layout behind a good desktop
              one, which is the failure this panel exists to catch. */}
          <span className="wf-panel__score-note">worst breakpoint</span>
        </div>

        <dl className="wf-panel__sources">
          <div>
            <dt>Original</dt>
            <dd>
              <a href={run.reference} target="_blank" rel="noreferrer">
                {run.reference.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </dd>
          </div>
          <div>
            <dt>Rebuild</dt>
            <dd>
              {run.rebuild.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              {run.rebuildOverlay && (
                <span className="wf-panel__overlay-note"> + {run.rebuildOverlay}</span>
              )}
            </dd>
          </div>
        </dl>

        <Button variant="secondary" onClick={() => void execute(source)}>
          Compare again
        </Button>
      </header>

      {run.history.length > 1 && <FidelityHistory history={run.history} />}

      <FidelityMatrix
        templates={run.templates}
        breakpoints={breakpoints}
        selected={selected}
        onSelect={(template, breakpoint) => setSelected({ template, breakpoint })}
      />

      {comparison && selected ? (
        <ComparisonViewer comparison={comparison} templateLabel={selected.template} />
      ) : (
        <p className="wf-panel__hint">Pick a score to see what produced it.</p>
      )}
    </div>
  );
}

/**
 * Where the loop has been.
 *
 * One bar per pass, labelled with the fix that pass made. This is the part
 * that turns a score into a process: it shows that the number moved, and what
 * moved it, which is what tells you whether to keep going or stop.
 */
function FidelityHistory({ history }: { history: FidelityRun['history'] }) {
  const first = history[0];
  const last = history[history.length - 1];

  return (
    <section className="wf-history" aria-label="Comparison history">
      <div className="wf-history__summary">
        <span className="wf-history__from">{first.score.toFixed(1)}%</span>
        <span className="wf-history__arrow" aria-hidden="true">
          →
        </span>
        <span className="wf-history__to">{last.score.toFixed(1)}%</span>
        <span className="wf-history__passes">
          over {history.length} {history.length === 1 ? 'pass' : 'passes'} at 1440px
        </span>
      </div>
      <ol className="wf-history__list">
        {history.map((entry) => {
          const band = fidelityBand(entry.score);
          return (
            <li key={entry.iteration} className="wf-history__item">
              <div className="wf-history__track">
                {/* Anchored at 80 rather than 0: every score worth reading sits
                    in the last fifth of the range, and a bar from zero makes
                    89% and 100% look like the same bar. */}
                <div
                  className={`wf-history__bar wf-history__bar--${band}`}
                  /* inline-style-ok: bar length is the measurement itself */
                  style={{ width: `${Math.max(0, (entry.score - 80) / 0.2)}%` }}
                />
              </div>
              <span className="wf-history__value">{entry.score.toFixed(2)}%</span>
              <span className="wf-history__note">{entry.note}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
