/**
 * Starting a migration: one field, one URL.
 *
 * An earlier version of this asked the user to pick between connecting a
 * Webflow account, uploading an export and pasting a URL, and explained what
 * each could and could not carry. It was honest and it was the wrong screen —
 * three doors, two of them gated behind someone else's paid plan, in front of
 * a job the third door can do for any site on the internet.
 *
 * It lives inside the New Project flow rather than in a modal of its own,
 * because rebuilding a site *is* creating a project: it needs a name, a folder
 * and a stack exactly like every other one, and a parallel path would have had
 * to reinvent all three. It borrows that flow's own furniture for the same
 * reason — the field is the `<label>` + `<input>` pair the name step uses and
 * `.create-modal-content` already styles, and the section headings are the
 * `.stack-group-title` the stack picker beside it uses. A tab that invents its
 * own field and its own headings reads as a different product.
 */

import { PhaseRail } from './PhaseRail';
import { TemplateCard } from '../dashboard/TemplateCard';
import type { MigrationPhase } from '@/lib/migration';
import type { Template } from '../../hooks/useProjectCreation';

interface SiteUrlPanelProps {
  url: string;
  onUrlChange: (url: string) => void;
  /** Stacks offered. Web templates only — this rebuilds websites. */
  templates: Template[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: Template) => void;
  /** True once the field holds something that is not a web address. */
  invalid: boolean;
}

/**
 * The method, in the state it is actually in before anything has run.
 *
 * The same rail the Migration panel fills in later, so the five steps are
 * recognisable when the user meets them again. Details are omitted here: at
 * this point they would be promises, and the rail's detail line is reserved
 * for outcomes.
 */
const PLAN: MigrationPhase[] = [
  { id: 'survey', label: 'Survey', status: 'not-started', detail: '' },
  { id: 'design-system', label: 'Design system', status: 'not-started', detail: '' },
  { id: 'homepage', label: 'Homepage', status: 'not-started', detail: '' },
  { id: 'templates', label: 'Templates', status: 'not-started', detail: '' },
  { id: 'remainder', label: 'Remainder', status: 'not-started', detail: '' },
];

/**
 * Accept what a person would actually paste.
 *
 * Someone copying their own site's address does not type the scheme, and
 * rejecting `example.com` for that would be pedantry dressed as validation.
 */
export function normaliseUrl(raw: string): string | null {
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

export function SiteUrlPanel({
  url,
  onUrlChange,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  invalid,
}: SiteUrlPanelProps) {
  return (
    <div className="mig-url">
      <label>
        The site you want rebuilt
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="yoursite.com"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'mig-url-error' : undefined}
        />
      </label>
      {invalid && (
        <p className="error" id="mig-url-error">
          That doesn’t look like a web address.
        </p>
      )}

      <div className="stack-group">
        <h3 className="stack-group-title">Build it with</h3>
        <div className="stack-grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              name={template.name}
              description={template.description}
              selected={selectedTemplateId === template.id}
              onSelect={() => onSelectTemplate(template)}
            />
          ))}
        </div>
      </div>

      <div className="stack-group">
        <h3 className="stack-group-title">What happens next</h3>
        <PhaseRail phases={PLAN} variant="compact" />
        {/* The two promises the whole feature rests on. Stated here so they are
            a commitment made up front, not a defence offered later. */}
        <p className="mig-url__promise">
          Nothing is reported as done until it has been measured against the original, and anything
          that can’t come across is named rather than quietly dropped.
        </p>
      </div>
    </div>
  );
}
