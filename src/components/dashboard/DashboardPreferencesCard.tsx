/**
 * DashboardPreferencesCard — dashboard sidebar shortcuts for settings and updates.
 *
 * @module components/DashboardPreferencesCard
 */

import { HistoryIcon, SettingsIcon } from '@/components/icons';
import { Button } from '../primitives/Button';
import { DashboardCardDisclosure } from './DashboardCardDisclosure';

interface DashboardPreferencesCardProps {
  onOpenSettings: () => void;
  onOpenChangelog: () => void;
}

/**
 * Renders dashboard preference shortcuts and records their click events.
 * @param props - Callbacks that open settings and changelog surfaces.
 */
export function DashboardPreferencesCard({
  onOpenSettings,
  onOpenChangelog,
}: DashboardPreferencesCardProps) {
  return (
    <DashboardCardDisclosure
      storageKey="shipstudio.dashboard.preferencesExpanded"
      defaultExpanded
      title="Preferences"
      subtitle={
        <p className="dashboard-card-subtitle text-style-body-medium">
          Adjust app settings or review recent updates.
        </p>
      }
    >
      <div className="dashboard-card-rows">
        <Button
          variant="default"
          size="default"
          width="hug"
          className="dashboard-card-row"
          data-education-id="settings-button"
          onClick={onOpenSettings}
        >
          <div className="dashboard-card-row-icon">
            <SettingsIcon size={18} />
          </div>
          <div className="dashboard-card-row-main">
            <div className="dashboard-card-row-name text-style-body-medium">Settings</div>
            <div className="dashboard-card-row-status text-style-control">
              Dashboard widgets, compact mode, learn mode
            </div>
          </div>
        </Button>
        <Button
          variant="default"
          size="default"
          width="hug"
          className="dashboard-card-row"
          onClick={onOpenChangelog}
        >
          <div className="dashboard-card-row-icon">
            <HistoryIcon size={14} />
          </div>
          <div className="dashboard-card-row-main">
            <div className="dashboard-card-row-name text-style-body-medium">What's New</div>
            <div className="dashboard-card-row-status text-style-control">
              Recent updates and downgrade to older versions
            </div>
          </div>
        </Button>
      </div>
    </DashboardCardDisclosure>
  );
}
