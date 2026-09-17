/**
 * A dashboard card whose body folds away behind its own header.
 *
 * The three cards below the project grid — Workspace accounts, Preferences and
 * Tools on this Mac — are one stack and should behave like one. Tools already
 * expanded and collapsed; the other two were always open, so the stack grew
 * downwards forever and the header you wanted was wherever the card above it
 * happened to end.
 *
 * The header is a real `<button>`, not a `role="button"` section: the card
 * bodies contain buttons of their own (Install, Settings, Connect), and a
 * clickable section wrapping them would nest interactive elements and hand the
 * whole card one enormous hit target. Whether a card is open is remembered per
 * card, so the arrangement someone settles on survives a restart.
 *
 * @module components/dashboard/DashboardCardDisclosure
 */

import type { ReactNode } from 'react';
import { ChevronIcon } from '@/components/icons';
import { useLocalStorageFlag } from '../../hooks/useLocalStorageFlag';

interface DashboardCardDisclosureProps {
  /** localStorage key holding whether this card is open. */
  storageKey: string;
  /** Open on first ever render. Cards that are purely informational stay shut. */
  defaultExpanded?: boolean;
  /** Card heading. Also the button's accessible name, so it stays exact. */
  title: string;
  /** Sits under the title inside the button. Kept to text and small icons. */
  subtitle?: ReactNode;
  /** Rendered between the heading and the chevron (a spinner, a count). */
  aside?: ReactNode;
  /** Extra classes for the `<section>` — card-specific styling hooks. */
  className?: string;
  /** Passed through to the `<section>` for the education overlay. */
  educationId?: string;
  /** The body. Only rendered while the card is open. */
  children: ReactNode;
}

export function DashboardCardDisclosure({
  storageKey,
  defaultExpanded = false,
  title,
  subtitle,
  aside,
  className,
  educationId,
  children,
}: DashboardCardDisclosureProps) {
  const [isExpanded, , toggle] = useLocalStorageFlag(storageKey, defaultExpanded);

  return (
    <section
      className={`dashboard-card dashboard-disclosure ${isExpanded ? 'is-expanded' : ''} ${
        className ?? ''
      }`}
      data-education-id={educationId}
    >
      <button
        type="button"
        className="dashboard-card-header dashboard-disclosure__header"
        aria-expanded={isExpanded}
        // The title alone. Without this the accessible name would absorb the
        // subtitle, and "Tools on this Mac" would become a paragraph.
        aria-label={title}
        onClick={toggle}
      >
        <div>
          <h3 className="dashboard-card-title text-style-h4">{title}</h3>
          {subtitle}
        </div>
        {aside}
        <ChevronIcon
          size={14}
          className={`dashboard-disclosure__chevron ${isExpanded ? 'up' : 'down'}`}
        />
      </button>

      {/* The card gives its padding to the header, which has to span the full
          width to be one hit target; the body takes it back here. */}
      {isExpanded && <div className="dashboard-disclosure__body">{children}</div>}
    </section>
  );
}
