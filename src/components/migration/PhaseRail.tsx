/**
 * The method, as a rail.
 *
 * Shared deliberately between the screen that starts a migration and the panel
 * that reports on one. Someone who has seen these five steps before they
 * committed recognises the same rail filling in afterwards, and the ordering —
 * which is the whole method — gets stated twice without being written twice.
 *
 * Two densities, because the two screens have different room and different
 * jobs. `full` carries each phase's own line, which is where the panel earns
 * trust: "Survey ✓" and "Survey — 18 URLs across 4 templates" are different
 * amounts of trust, and only the second is checkable. `compact` is names only,
 * for the create flow, where these are intentions rather than outcomes and
 * fifteen lines of explanation would bury the field the user came to fill in.
 */

import { AlertIcon, CheckIcon, PendingCircleIcon } from '@/components/icons';
import { PHASE_LABEL, type MigrationPhase, type PhaseStatus } from '@/lib/migration';

const PHASE_ICON: Record<PhaseStatus, typeof CheckIcon> = {
  done: CheckIcon,
  active: PendingCircleIcon,
  blocked: AlertIcon,
  'not-started': PendingCircleIcon,
};

/**
 * The backend normalises what the agent wrote, so this should never miss.
 * It is here anyway because the cost of being wrong is the whole panel
 * throwing on an undefined component, and the cost of being right is a
 * fallback nobody sees.
 */
function phaseIcon(status: PhaseStatus) {
  return PHASE_ICON[status] ?? PendingCircleIcon;
}

interface PhaseRailProps {
  phases: MigrationPhase[];
  variant?: 'full' | 'compact';
}

export function PhaseRail({ phases, variant = 'full' }: PhaseRailProps) {
  return (
    <ol className={`mig-rail mig-rail--${variant}`} aria-label="Migration phases">
      {phases.map((phase, index) => {
        const Icon = phaseIcon(phase.status);
        return (
          <li key={phase.id} className={`mig-rail__item mig-rail__item--${phase.status}`}>
            <span className="mig-rail__marker" aria-hidden="true">
              {/* Compact is used where nothing has started, so five identical
                  pending icons would say nothing — and, sitting under a grid of
                  selectable cards, would read as five more things to choose.
                  The position is the information there. */}
              {variant === 'compact' ? index + 1 : <Icon size={12} />}
            </span>
            <div className="mig-rail__body">
              <span className="mig-rail__label">
                {PHASE_LABEL[phase.id]}
                {phase.status === 'active' && <span className="mig-rail__now">now</span>}
              </span>
              {variant === 'full' && <span className="mig-rail__detail">{phase.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
