/**
 * The Layout menu — the half of this feature that is not a drag.
 *
 * A drag is the fast way to move a panel and must never be the only way, so
 * everything the pointer can do is here as a control with a name: which side
 * each panel is on, docked or floating, one step either way. Plus the two
 * things a drag cannot express at all.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu';
import { PanelDockProvider } from '../../contexts/PanelDockContext';
import { DEFAULT_LAYOUT, LAYOUT_PRESETS, PREVIEW } from '../../lib/workspaceLayout';
import {
  hasProjectLayout,
  readDefaultLayout,
  readProjectLayout,
  writeProjectLayout,
} from '../../lib/workspaceLayoutStore';

const PROJECT = '/Users/dev/ShipStudio/site';

beforeEach(() => localStorage.clear());

async function openMenu(layout?: unknown) {
  if (layout) writeProjectLayout(PROJECT, layout as never);
  const user = userEvent.setup();
  render(
    <PanelDockProvider projectPath={PROJECT}>
      <WorkspaceLayoutMenu />
    </PanelDockProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Panel layout' }));
  return user;
}

/** The row for one panel, so its controls can be reached by name. */
function row(label: string) {
  return screen.getByText(label).closest('.workspace-layout-menu__row') as HTMLElement;
}

function pointer(type: string, x: number, y: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

function mockMenuRects() {
  const items = [...document.querySelectorAll<HTMLElement>('[data-drag-sort-item]')];
  items.forEach((item, index) => {
    Object.defineProperty(item, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: index * 30,
        right: 280,
        bottom: index * 30 + 20,
        width: 280,
        height: 20,
      }),
    });
  });
}

describe('the menu', () => {
  it('uses the quiet ghost treatment for the panel layout trigger', () => {
    render(
      <PanelDockProvider projectPath={PROJECT}>
        <WorkspaceLayoutMenu />
      </PanelDockProvider>
    );

    expect(screen.getByRole('button', { name: 'Panel layout' })).toHaveClass('button--ghost');
  });

  it('uses the standard right-side chevron treatment', () => {
    render(
      <PanelDockProvider projectPath={PROJECT}>
        <WorkspaceLayoutMenu />
      </PanelDockProvider>
    );

    const trigger = screen.getByRole('button', { name: 'Panel layout' });
    expect(trigger.querySelector('[data-icon-name="ChevronIcon"]')).toHaveAttribute('width', '14');
  });

  it('uses the default button treatment for every starting point', async () => {
    await openMenu();

    for (const preset of LAYOUT_PRESETS) {
      expect(screen.getByRole('button', { name: preset.label })).toHaveClass('button--default');
    }
  });

  it('says where every panel currently is', async () => {
    await openMenu({
      order: ['agent', PREVIEW, 'editor', 'team', 'navigator', 'variables'],
      floating: ['team'],
      widths: {},
    });

    expect(within(row('Agent')).getByText('Left')).toBeInTheDocument();
    expect(within(row('Edit')).getByText('Right')).toBeInTheDocument();
    expect(within(row('Team')).getByText('Floating')).toBeInTheDocument();
  });

  it('keeps the drag handle as the leading row control', async () => {
    await openMenu();

    const agentRow = row('Agent');
    const handle = within(agentRow).getByRole('button', { name: 'Move Agent panel' });
    expect(agentRow.firstElementChild).toBe(handle);
    expect(handle.parentElement).toBe(agentRow);

    handle.focus();
    expect(handle).toHaveFocus();
    expect(agentRow).toContainElement(document.activeElement as HTMLElement);
  });

  it('uses Preview as the single left/right structural boundary', async () => {
    await openMenu({
      order: ['agent', 'navigator', PREVIEW, 'editor', 'team', 'variables'],
      floating: [],
      widths: {},
    });

    const previewRow = row('Preview');
    const rightPanel = row('Edit');
    expect(previewRow).toHaveClass('is-boundary');
    expect(
      previewRow.compareDocumentPosition(rightPanel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(rightPanel.previousElementSibling).not.toHaveClass('ss-dropdown__divider');
    expect(screen.queryByText('Canvas')).not.toBeInTheDocument();
  });

  it('moves a panel across the preview a step at a time', async () => {
    const user = await openMenu({
      order: ['agent', PREVIEW, 'editor', 'team', 'navigator', 'variables'],
      floating: [],
      widths: {},
    });

    await user.click(within(row('Agent')).getByRole('button', { name: 'Move Agent right' }));

    expect(within(row('Agent')).getByText('Right')).toBeInTheDocument();
    const saved = readProjectLayout(PROJECT).order;
    expect(saved.indexOf('agent')).toBeGreaterThan(saved.indexOf(PREVIEW));
  });

  it('will not move a panel off either end', async () => {
    await openMenu({
      order: ['agent', PREVIEW, 'editor', 'team', 'navigator', 'variables'],
      floating: [],
      widths: {},
    });
    expect(within(row('Agent')).getByRole('button', { name: 'Move Agent left' })).toBeDisabled();
    expect(
      within(row('Variables')).getByRole('button', { name: 'Move Variables right' })
    ).toBeDisabled();
  });

  it('floats and re-docks a panel, and the pin says which it is', async () => {
    const user = await openMenu({
      order: ['agent', 'navigator', PREVIEW, 'editor', 'team', 'variables'],
      floating: [],
      widths: {},
    });

    const float = within(row('Navigator')).getByRole('button', { name: 'Float Navigator' });
    expect(float.parentElement).toHaveClass('workspace-layout-menu__heading');
    expect(float.parentElement?.firstElementChild).toBe(float);
    expect(float.parentElement).toContainElement(screen.getByText('Navigator'));
    expect(float).toHaveAttribute('aria-pressed', 'true');
    await user.click(float);

    expect(readProjectLayout(PROJECT).floating).toContain('navigator');
    const dock = within(row('Navigator')).getByRole('button', { name: 'Dock Navigator' });
    expect(dock).toHaveAttribute('aria-pressed', 'false');

    await user.click(dock);
    expect(readProjectLayout(PROJECT).floating).not.toContain('navigator');
    // Back where it was, not at an end.
    expect(readProjectLayout(PROJECT).order[1]).toBe('navigator');
  });

  it('applies a preset as an ordinary layout', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('button', { name: 'Focus' }));

    const saved = readProjectLayout(PROJECT);
    expect(saved.floating).toEqual(
      expect.arrayContaining(['navigator', 'variables', 'editor', 'team'])
    );
    expect(saved.floating).not.toContain('agent');
  });

  it('sorts around the locked Preview separator and keeps the menu open', async () => {
    await openMenu();
    vi.useFakeTimers();
    try {
      mockMenuRects();
      const handle = within(row('Agent')).getByRole('button', { name: 'Move Agent panel' });
      fireEvent(handle, pointer('pointerdown', 10, 40));
      fireEvent(window, pointer('pointermove', 10, 140));
      fireEvent(window, pointer('pointerup', 10, 140));
      await act(() => vi.advanceTimersByTime(250));

      expect(readProjectLayout(PROJECT).order).toEqual([
        'team',
        'variables',
        'navigator',
        PREVIEW,
        'agent',
        'editor',
      ]);
      const agentRow = document.querySelector('[data-drag-sort-id="agent"]') as HTMLElement;
      expect(within(agentRow).getByText('Right')).toBeInTheDocument();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a full-row portal overlay that follows the pointer', async () => {
    await openMenu();
    vi.useFakeTimers();
    try {
      mockMenuRects();
      const agentRow = row('Agent');
      const handle = within(agentRow).getByRole('button', { name: 'Move Agent panel' });
      fireEvent(handle, pointer('pointerdown', 10, 40));
      fireEvent(window, pointer('pointermove', 20, 140));

      const overlay = document.querySelector('[data-drag-sort-overlay="true"]') as HTMLElement;
      expect(overlay).toBeInTheDocument();
      expect(overlay.querySelector('[data-drag-sort-overlay-content="true"]')).toBeInTheDocument();
      expect(within(overlay).getByText('Agent')).toBeInTheDocument();
      expect(overlay.querySelectorAll('button')).toHaveLength(0);
      expect(overlay.style.getPropertyValue('--drag-sort-overlay-width')).toBe('280px');
      expect(overlay.style.getPropertyValue('--drag-sort-overlay-height')).toBe('20px');
      expect(overlay.style.getPropertyValue('--drag-sort-overlay-y')).toBe('130px');
      expect(agentRow).toHaveClass('is-dragging');
      expect(agentRow).toHaveAttribute('data-drag-sort-has-overlay', 'true');

      fireEvent(window, pointer('pointermove', 20, 40));
      expect(document.querySelector('[data-drag-sort-overlay="true"]')).toBeInTheDocument();
      expect(
        (
          document.querySelector('[data-drag-sort-overlay="true"]') as HTMLElement
        ).style.getPropertyValue('--drag-sort-overlay-y')
      ).toBe('30px');

      fireEvent(window, pointer('pointercancel', 20, 140));
      await act(() => vi.advanceTimersByTime(250));
      expect(document.querySelector('[data-drag-sort-overlay="true"]')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not persist a cancelled or no-op drag', async () => {
    await openMenu();
    mockMenuRects();
    const handle = within(row('Agent')).getByRole('button', { name: 'Move Agent panel' });
    const before = readProjectLayout(PROJECT).order;
    fireEvent(handle, pointer('pointerdown', 10, 40));
    fireEvent(window, pointer('pointermove', 10, 140));
    fireEvent(window, pointer('pointercancel', 10, 140));
    expect(readProjectLayout(PROJECT).order).toEqual(before);

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent(handle, pointer('pointerdown', 10, 40, 2));
    fireEvent(window, pointer('pointermove', 10, 40, 2));
    fireEvent(window, pointer('pointerup', 10, 40, 2));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('the default', () => {
  it('offers nothing to save until something has changed', async () => {
    const user = await openMenu();
    const save = screen.getByRole('menuitem', { name: /Save as my default/ });
    expect(save).toBeDisabled();

    // The move controls are not menu items — the menu stays open, so you can
    // arrange several panels and then save, which is the actual workflow.
    await user.click(within(row('Agent')).getByRole('button', { name: 'Move Agent right' }));
    expect(screen.getByRole('menuitem', { name: /Save as my default/ })).toBeEnabled();
    await user.click(screen.getByRole('menuitem', { name: /Save as my default/ }));

    // The default now *is* this arrangement, so unarranged projects follow it.
    expect(readDefaultLayout().order).toEqual(readProjectLayout(PROJECT).order);
    expect(readDefaultLayout().order).not.toEqual(DEFAULT_LAYOUT.order);
  });

  it('offers nothing to reset on a project that has no arrangement of its own', async () => {
    await openMenu();
    expect(screen.getByRole('menuitem', { name: /Reset this project/ })).toBeDisabled();
  });

  it('resets a project back to following the default', async () => {
    const user = await openMenu({
      order: [PREVIEW, 'agent', 'navigator', 'variables', 'editor', 'team'],
      floating: [],
      widths: {},
    });
    expect(hasProjectLayout(PROJECT)).toBe(true);

    await user.click(screen.getByRole('menuitem', { name: /Reset this project/ }));

    expect(hasProjectLayout(PROJECT)).toBe(false);
  });
});
