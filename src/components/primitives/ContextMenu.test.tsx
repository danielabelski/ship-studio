import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ContextMenu';

function renderMenu(onSelect = vi.fn()) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button type="button">Target</button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>First</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>Second</ContextMenuItem>
        <ContextMenuItem disabled>Disabled</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe('ContextMenu', () => {
  it('can open from a click trigger as well as a context-menu gesture', () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger asChild openOnClick>
          <button type="button">More</button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Action</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Action' })).toHaveFocus();
  });

  it('right-aligns a click-triggered menu to its trigger', () => {
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('ss-context-menu')) {
          return {
            bottom: 100,
            height: 80,
            left: 0,
            right: 120,
            top: 20,
            width: 120,
            x: 0,
            y: 20,
          } as DOMRect;
        }
        return {
          bottom: 60,
          height: 20,
          left: 100,
          right: 200,
          top: 40,
          width: 100,
          x: 100,
          y: 40,
        } as DOMRect;
      });

    try {
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild openOnClick>
            <button type="button">More</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );

      fireEvent.click(screen.getByRole('button', { name: 'More' }));

      expect(screen.getByRole('menu')).toHaveStyle({ left: '80px', top: '60px' });
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });

  it('opens at the context-menu gesture and selects an item', async () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Target' }), {
      clientX: 120,
      clientY: 80,
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem', { name: 'First' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('supports keyboard movement, disabled items, Escape, and outside dismissal', async () => {
    renderMenu();
    const target = screen.getByRole('button', { name: 'Target' });

    fireEvent.contextMenu(target);
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });

    expect(screen.getByRole('menuitem', { name: 'Disabled' })).toBeDisabled();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.contextMenu(target);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
