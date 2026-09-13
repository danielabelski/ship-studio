/**
 * The Layout menu: every arrangement move, without a drag.
 *
 * A drag is the fast way to move a panel and it is nobody's *only* way. This
 * menu does all of it from the keyboard — which side each panel is on, docked
 * or floating, one step left or right — and holds the two operations a drag
 * cannot express at all: making the current arrangement your default, and
 * giving a project back to it.
 *
 * @module components/workspace/WorkspaceLayoutMenu
 */

import { ChevronIcon, DragHandleIcon, PanelLayoutIcon, PinIcon } from '@/components/icons';
import { Button } from '../primitives/Button';
import { Dropdown, DropdownDivider, DropdownItem } from '../primitives/Dropdown';
import { MenuButton } from '../primitives/MenuButton';
import { DragSortHandle, DragSortItem, DragSortScope } from '../primitives/DragSort';
import { usePanelDock } from '../../contexts/PanelDockContext';
import {
  LAYOUT_PRESETS,
  PANEL_META,
  PREVIEW,
  indexOf,
  isDocked,
  type PanelId,
  type RailItem,
} from '../../lib/workspaceLayout';

interface PanelLayoutRowContentProps {
  panel: PanelId;
  docked: boolean;
  at: number;
  previewAt: number;
  lastIndex: number;
  interactive: boolean;
  onToggleDock?: () => void;
  onNudge?: (delta: -1 | 1) => void;
}

function PanelLayoutRowContent({
  panel,
  docked,
  at,
  previewAt,
  lastIndex,
  interactive,
  onToggleDock,
  onNudge,
}: PanelLayoutRowContentProps) {
  const label = PANEL_META[panel].label;
  const pin = interactive ? (
    <button
      type="button"
      className={`workspace-layout-menu__move workspace-layout-menu__move--pin${
        docked ? ' is-on' : ''
      }`}
      onClick={onToggleDock}
      aria-pressed={docked}
      title={docked ? `Float ${label} over the workspace` : `Dock ${label} into the workspace`}
      aria-label={docked ? `Float ${label}` : `Dock ${label}`}
    >
      <PinIcon size={12} />
    </button>
  ) : (
    <span
      className={`workspace-layout-menu__move workspace-layout-menu__move--pin${
        docked ? ' is-on' : ''
      }`}
      aria-hidden="true"
    >
      <PinIcon size={12} />
    </span>
  );
  const moves = interactive ? (
    <>
      <button
        type="button"
        className="workspace-layout-menu__move workspace-layout-menu__move--left"
        onClick={() => onNudge?.(-1)}
        disabled={at === 0}
        title={`Move ${label} left`}
        aria-label={`Move ${label} left`}
      >
        <ChevronIcon size={12} />
      </button>
      <button
        type="button"
        className="workspace-layout-menu__move workspace-layout-menu__move--right"
        onClick={() => onNudge?.(1)}
        disabled={at === lastIndex}
        title={`Move ${label} right`}
        aria-label={`Move ${label} right`}
      >
        <ChevronIcon size={12} />
      </button>
    </>
  ) : (
    <>
      <span
        className="workspace-layout-menu__move workspace-layout-menu__move--left"
        aria-hidden="true"
      >
        <ChevronIcon size={12} />
      </span>
      <span
        className="workspace-layout-menu__move workspace-layout-menu__move--right"
        aria-hidden="true"
      >
        <ChevronIcon size={12} />
      </span>
    </>
  );

  return (
    <>
      <span className="workspace-layout-menu__heading">
        {pin}
        <span className="workspace-layout-menu__name">{label}</span>
      </span>
      <span className="workspace-layout-menu__where">
        {docked ? (at < previewAt ? 'Left' : 'Right') : 'Floating'}
      </span>
      <span className="workspace-layout-menu__moves">{moves}</span>
    </>
  );
}

function PanelLayoutRowOverlay({
  panel,
  docked,
  at,
  previewAt,
  lastIndex,
}: Omit<PanelLayoutRowContentProps, 'interactive' | 'onToggleDock' | 'onNudge'>) {
  return (
    <div
      className="workspace-layout-menu__row workspace-layout-menu__row--overlay"
      data-drag-sort-overlay-content="true"
      aria-hidden="true"
    >
      <span className="workspace-layout-menu__drag-handle-ghost">
        <DragHandleIcon size={14} />
      </span>
      <PanelLayoutRowContent
        panel={panel}
        docked={docked}
        at={at}
        previewAt={previewAt}
        lastIndex={lastIndex}
        interactive={false}
      />
    </div>
  );
}

export function WorkspaceLayoutMenu() {
  const {
    layout,
    isCustomised,
    differsFromDefault,
    nudge,
    setOrder,
    setDocked,
    applyPreset,
    saveAsDefault,
    resetToDefault,
  } = usePanelDock();

  const previewAt = indexOf(layout, PREVIEW);
  const commitProjectedOrder = (move: { projectedOrder?: readonly (string | number)[] }) => {
    if (move.projectedOrder) setOrder(move.projectedOrder as RailItem[]);
  };
  const hasLeftDockedPanel = layout.order.some(
    (item) => item !== PREVIEW && isDocked(layout, item) && indexOf(layout, item) < previewAt
  );
  const hasRightDockedPanel = layout.order.some(
    (item) => item !== PREVIEW && isDocked(layout, item) && indexOf(layout, item) > previewAt
  );
  const showSideDivider = hasLeftDockedPanel && hasRightDockedPanel;

  return (
    <Dropdown
      portal
      align="right"
      menuClassName="workspace-layout-menu"
      trigger={(p) => (
        <MenuButton
          variant="ghost"
          expanded={Boolean(p['aria-expanded'])}
          title="Panel layout"
          aria-label="Panel layout"
          data-workspace-panel="layout"
          leftIcon={<PanelLayoutIcon size={16} />}
          rightIcon={<ChevronIcon />}
          {...p}
        />
      )}
    >
      <DragSortScope
        axis="vertical"
        items={layout.order}
        label="Panel layout"
        onMove={commitProjectedOrder}
      >
        <div className="workspace-layout-menu__section">Panels</div>
        {layout.order.map((item, itemIndex) => {
          if (item === PREVIEW) {
            return (
              <DragSortItem
                key={item}
                id={item}
                index={itemIndex}
                label="Preview"
                disabled
                className={`workspace-layout-menu__row workspace-layout-menu__row--preview${
                  showSideDivider ? ' is-boundary' : ''
                }`}
              >
                <span className="workspace-layout-menu__preview-label">Preview</span>
              </DragSortItem>
            );
          }
          const panel = item;
          const at = indexOf(layout, panel);
          const docked = isDocked(layout, panel);
          return (
            <DragSortItem
              key={panel}
              id={panel}
              index={itemIndex}
              label={PANEL_META[panel].label}
              className="workspace-layout-menu__row"
              overlay={
                <PanelLayoutRowOverlay
                  panel={panel}
                  docked={docked}
                  at={at}
                  previewAt={previewAt}
                  lastIndex={layout.order.length - 1}
                />
              }
            >
              <DragSortHandle label={`Move ${PANEL_META[panel].label} panel`} />
              <PanelLayoutRowContent
                panel={panel}
                docked={docked}
                at={at}
                previewAt={previewAt}
                lastIndex={layout.order.length - 1}
                interactive
                onToggleDock={() => setDocked(panel, !docked)}
                onNudge={(delta) => nudge(panel, delta)}
              />
            </DragSortItem>
          );
        })}

        <DropdownDivider />
        {/* A row rather than a list of described items. They are four starting
          points, not four commands, and stacking them with their descriptions
          pushed the two things below — save-as-default and reset — under the
          menu's scroll line, which is where the useful half of a menu goes to
          be never found. The description is the tooltip. */}
        <div className="workspace-layout-menu__section">Start from</div>
        <div className="workspace-layout-menu__presets">
          {LAYOUT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant="default"
              size="compact"
              title={preset.description}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <DropdownDivider />
        <DropdownItem onSelect={saveAsDefault} disabled={!differsFromDefault}>
          Save as my default layout
        </DropdownItem>
        {/* Disabled rather than hidden when the project has no arrangement of its
          own: "there is nothing to reset" is a useful thing to be able to see,
          and a menu whose items move around is harder to use than one whose
          items are sometimes greyed. */}
        <DropdownItem onSelect={resetToDefault} disabled={!isCustomised}>
          Reset this project to the default
        </DropdownItem>
      </DragSortScope>
    </Dropdown>
  );
}
