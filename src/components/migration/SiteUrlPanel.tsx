/**
 * Starting a migration: one field, one URL.
 *
 * An earlier version of this asked the user to pick between connecting a
 * Webflow account, uploading an export and pasting a URL, and explained what
 * each tier could and could not carry. It was honest and it was the wrong
 * screen — three doors, two of them gated behind someone else's paid plan, in
 * front of a job the third door can do for any site on the internet.
 *
 * So: a URL. What the agent is about to do with it is stated here rather than
 * discovered later, because the method is the product — a user who does not
 * know that tokens come before pages will read the first twenty minutes as the
 * agent not having started.
 */

import { useState, type FormEvent } from 'react';
import { ModalFrame } from '../primitives/ModalFrame';
import { Button } from '../primitives/Button';
import { TextField } from '../primitives/TextField';
import { PHASE_LABEL, type MigrationPhaseId } from '@/lib/migration';

interface SiteUrlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (url: string) => void;
}

/** What each phase will do, in the skill's own order. */
const PLAN: { id: MigrationPhaseId; detail: string }[] = [
  { id: 'survey', detail: 'Crawl the site and group its pages into templates.' },
  {
    id: 'design-system',
    detail: 'Read the real computed values — colour, type, spacing — and build a style guide.',
  },
  {
    id: 'homepage',
    detail: 'Rebuild one page, verify it against the original, and check with you.',
  },
  { id: 'templates', detail: 'Then the rest, one at a time, each verified the same way.' },
  { id: 'remainder', detail: 'Finish by naming everything that could not come across.' },
];

/**
 * Accept what a person would actually paste.
 *
 * Someone copying their own site's address does not type the scheme, and
 * rejecting `example.com` for that would be pedantry dressed as validation.
 */
function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

export function SiteUrlPanel({ isOpen, onClose, onStart }: SiteUrlPanelProps) {
  const [raw, setRaw] = useState('');
  const normalised = normaliseUrl(raw);
  // Only complain once there is something to complain about — an error against
  // an empty field is telling someone off for not having typed yet.
  const invalid = raw.trim().length > 0 && normalised === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (normalised) onStart(normalised);
  };

  return (
    <ModalFrame isOpen={isOpen} onClose={onClose} title="Rebuild a site" className="mig-url-modal">
      <form className="mig-url" onSubmit={submit}>
        <div className="mig-url__field">
          <label className="mig-url__label" htmlFor="mig-url-input">
            The site you want rebuilt
          </label>
          <TextField
            id="mig-url-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="yoursite.com"
            autoFocus
            invalid={invalid}
            aria-describedby={invalid ? 'mig-url-error' : undefined}
          />
          {invalid && (
            <p className="mig-url__error" id="mig-url-error">
              That doesn’t look like a web address.
            </p>
          )}
        </div>

        <section className="mig-url__plan">
          <h4 className="mig-url__plan-title">What happens next</h4>
          <ol className="mig-url__steps">
            {PLAN.map((step) => (
              <li key={step.id}>
                <span className="mig-url__step-label">{PHASE_LABEL[step.id]}</span>
                <span className="mig-url__step-detail">{step.detail}</span>
              </li>
            ))}
          </ol>
          {/* The two promises the whole feature rests on. Stated here so they
              are a commitment made up front, not a defence offered later. */}
          <p className="mig-url__promise">
            Nothing is reported as done until it has been measured against the original, and
            anything that can’t come across is named rather than quietly dropped.
          </p>
        </section>

        <footer className="mig-url__footer">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!normalised}>
            Start
          </Button>
        </footer>
      </form>
    </ModalFrame>
  );
}
