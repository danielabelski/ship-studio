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
          <h4 className="mig-needs__title">
            Waiting on you
            <span className="mig-needs__count">{status.needsYou.length}</span>
          </h4>
          {status.needsYou.map((q) => (
            /*
             * A disclosure rather than a stack of cards. The skill asks the
             * agent to bring its decisions in one batch, and a real survey
             * produced seven — as full cards that is a wall that pushes the
             * rest of the report off screen, and the questions stop being read
             * precisely because there are a lot of them.
             *
             * Open by default when there is one, because a single question is
             * the whole message.
             */
            <details key={q.id} className="mig-needs__item" open={status.needsYou.length === 1}>
              <summary className="mig-needs__head">
                <AlertIcon size={14} />
                <span className="mig-needs__question">{q.question}</span>
              </summary>
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
            </details>
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
