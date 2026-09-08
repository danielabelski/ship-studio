/**
 * Where the migration actually is — the honest half of the panel.
 *
 * The fidelity score says how good the rebuild is. It cannot say what has been
 * attempted, what was skipped, or what the agent is stuck on, and those are
 * the things a person actually wants to know while a long job runs. So this
 * sits above the score and answers four questions in the same four parts the
 * skill requires the agent to report in: done, doing, not done, needs you.
 *
 * The parts are shown even when they are empty, in fixed order. A migration
 * with nothing in "not done" is making a claim, and it should have to make it
 * out loud rather than by omitting a heading.
 */

import { AlertIcon, CheckIcon, CloseIcon, PendingCircleIcon } from '@/components/icons';
import { PhaseRail } from './PhaseRail';
import type { MigrationStatus } from '@/lib/migration';

interface MigrationStatusViewProps {
  status: MigrationStatus;
}

export function MigrationStatusView({ status }: MigrationStatusViewProps) {
  return (
    <div className="mig-status">
      <PhaseRail phases={status.phases} />

      {status.needsYou.length > 0 && (
        <section className="mig-needs" aria-label="Waiting on you">
          {status.needsYou.map((q) => (
            <article key={q.id} className="mig-needs__item">
              <header className="mig-needs__head">
                <AlertIcon size={14} />
                <h4 className="mig-needs__question">{q.question}</h4>
              </header>
              {q.why && <p className="mig-needs__why">{q.why}</p>}
              {/* A decision handed over without a recommendation is just the
                  work being handed back, so the skill asks for one — but an
                  agent that wrote only the question gets an empty label rather
                  than a suggestion, and an empty label is worse than none. */}
              {q.recommendation && (
                <p className="mig-needs__rec">
                  <span className="mig-needs__rec-label">Suggestion</span>
                  {q.recommendation}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      <div className="mig-report">
        <ReportColumn
          title="Doing"
          tone="doing"
          items={status.doing ? [status.doing] : []}
          empty="Nothing in flight."
        />
        <ReportColumn title="Done" tone="done" items={status.done} empty="Nothing finished yet." />
        <ReportColumn
          title="Not done"
          tone="pending"
          items={status.notDone}
          empty="Nothing outstanding."
        />
        <ReportColumn
          title="Can't carry across"
          tone="blocked"
          items={status.cannotCarry.map((c) => `${c.item} — ${c.reason}`)}
          empty="Nothing ruled out."
        />
      </div>
    </div>
  );
}

const COLUMN_ICON = {
  doing: PendingCircleIcon,
  done: CheckIcon,
  pending: PendingCircleIcon,
  blocked: CloseIcon,
} as const;

function ReportColumn({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: keyof typeof COLUMN_ICON;
  items: string[];
  empty: string;
}) {
  const Icon = COLUMN_ICON[tone];
  return (
    <section className={`mig-report__col mig-report__col--${tone}`}>
      <h4 className="mig-report__title">
        {title}
        <span className="mig-report__count">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="mig-report__empty">{empty}</p>
      ) : (
        <ul className="mig-report__list">
          {items.map((item) => (
            <li key={item}>
              <Icon size={12} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
