import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ElementTreePanel } from './ElementTreePanel';

describe('ElementTreePanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('describes pinning the floating panel and unpinning the docked panel', () => {
    const onTogglePin = vi.fn();
    const props = {
      tree: { id: 1, tag: 'body', cls: '', text: '', children: [] },
      truncated: false,
      selectedId: 1,
      affectedIds: [],
      onSelect: vi.fn(),
      onHover: vi.fn(),
      projectPath: '/tmp/project',
      selectedSignature: null,
      onTogglePin,
    };

    const { rerender } = render(<ElementTreePanel {...props} pinned={false} />);
    const pinButton = screen.getByRole('button', { name: 'Pin Elements panel to the window' });
    expect(pinButton).toHaveAttribute('title', 'Pin to the window');
    expect(pinButton).toHaveAttribute('aria-pressed', 'false');

    rerender(<ElementTreePanel {...props} pinned />);
    const unpinButton = screen.getByRole('button', { name: 'Unpin Elements panel' });
    expect(unpinButton).toHaveAttribute('title', 'Unpin — float over the workspace');
    expect(unpinButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows view-only state without a redundant Visual tab', () => {
    render(
      <ElementTreePanel
        tree={{
          id: 1,
          tag: 'body',
          cls: '',
          text: '',
          children: [{ id: 2, tag: 'div', cls: 'card', text: '', children: [] }],
        }}
        truncated={false}
        selectedId={1}
        affectedIds={[2]}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        projectPath="/tmp/project"
        selectedSignature={null}
      />
    );

    expect(screen.getByText('View only')).toHaveAttribute(
      'data-tooltip-content',
      'Turn on edit mode to select and edit elements.'
    );
    expect(screen.queryByText('View-only mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Visual' })).not.toBeInTheDocument();
    expect(
      screen.getByTestId('element-tree-panel').querySelector('[data-tree-id="2"]')
    ).toHaveClass('affected');
  });

  it('mirrors a preview hover on the matching row', () => {
    render(
      <ElementTreePanel
        tree={{
          id: 1,
          tag: 'body',
          cls: '',
          text: '',
          children: [{ id: 2, tag: 'div', cls: 'card', text: '', children: [] }],
        }}
        truncated={false}
        selectedId={1}
        hoveredId={2}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        projectPath="/tmp/project"
        selectedSignature={null}
      />
    );

    expect(
      screen.getByTestId('element-tree-panel').querySelector('[data-tree-id="2"]')
    ).toHaveClass('hovered');
  });

  it('swaps supported tag names for the Insert Element icons', () => {
    render(
      <ElementTreePanel
        tree={{
          id: 1,
          tag: 'body',
          cls: '',
          text: '',
          children: [
            { id: 2, tag: 'div', cls: 'card', text: '', children: [] },
            { id: 3, tag: 'main', cls: '', text: '', children: [] },
            { id: 4, tag: 'header', cls: '', text: '', children: [] },
            { id: 5, tag: 'nav', cls: '', text: '', children: [] },
            { id: 6, tag: 'code', cls: '', text: '', children: [] },
          ],
        }}
        truncated={false}
        selectedId={1}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        projectPath="/tmp/project"
        selectedSignature={null}
      />
    );

    const panel = screen.getByTestId('element-tree-panel');
    const toggle = screen.getByRole('button', { name: 'Show tag icons' });
    expect(panel.querySelector('[data-tree-id="2"] .ss-tree-tag')).toHaveTextContent('div');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show tag names' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      panel.querySelector('[data-tree-id="2"] [data-icon-name="ElementDivIcon"]')
    ).toBeInTheDocument();
    expect(panel.querySelector('[data-tree-id="2"] .ss-tree-tag')).not.toBeInTheDocument();
    expect(
      panel.querySelector('[data-tree-id="3"] [data-icon-name="ElementMainIcon"]')
    ).toBeInTheDocument();
    expect(panel.querySelector('[data-tree-id="3"] .ss-tree-tag')).not.toBeInTheDocument();
    expect(
      panel.querySelector('[data-tree-id="4"] [data-icon-name="ElementHeadIcon"]')
    ).toBeInTheDocument();
    expect(panel.querySelector('[data-tree-id="4"] .ss-tree-tag')).not.toBeInTheDocument();
    expect(
      panel.querySelector('[data-tree-id="5"] [data-icon-name="ElementNavIcon"]')
    ).toBeInTheDocument();
    expect(panel.querySelector('[data-tree-id="5"] .ss-tree-tag')).not.toBeInTheDocument();
    expect(
      panel.querySelector('[data-tree-id="6"] [data-icon-name="ElementCodeBlockIcon"]')
    ).toBeInTheDocument();
    expect(panel.querySelector('[data-tree-id="6"] .ss-tree-tag')).not.toBeInTheDocument();
  });

  it('remembers the tag icon preference when the panel remounts', () => {
    const props = {
      tree: { id: 1, tag: 'body', cls: '', text: '', children: [] },
      truncated: false,
      selectedId: 1,
      onSelect: vi.fn(),
      onHover: vi.fn(),
      projectPath: '/tmp/project',
      selectedSignature: null,
    };

    const { unmount } = render(<ElementTreePanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show tag icons' }));
    expect(localStorage.getItem('elementTreeShowTagIcons')).toBe('1');

    unmount();
    render(<ElementTreePanel {...props} />);

    expect(screen.getByRole('button', { name: 'Show tag names' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('uses the native context menu for structural actions and copies the node selector', async () => {
    const onSelect = vi.fn();
    const selectAndRun = vi.fn((_id: number, action: () => void) => action());
    const duplicate = vi.fn();
    const remove = vi.fn();
    const copy = vi.fn();
    const cut = vi.fn();
    const paste = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ElementTreePanel
        tree={{
          id: 1,
          tag: 'body',
          cls: '',
          text: '',
          children: [{ id: 2, tag: 'div', cls: 'card featured', text: '', children: [] }],
        }}
        truncated={false}
        selectedId={1}
        onSelect={onSelect}
        onHover={vi.fn()}
        projectPath="/tmp/project"
        selectedSignature={null}
        structure={{
          selectAndRun,
          insert: vi.fn(),
          duplicate,
          remove,
          copy,
          cut,
          paste,
          hasClipboard: true,
          clipboardSourceNodeId: 99,
        }}
      />
    );

    const row = screen.getByTestId('element-tree-panel').querySelector('[data-tree-id="2"]')!;
    fireEvent.contextMenu(row, { clientX: 80, clientY: 100 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const menu = screen.getByRole('menu');
    expect(
      Array.from(menu.children).map((child) =>
        child.getAttribute('role') === 'separator'
          ? 'divider'
          : (child.textContent ?? '').replace(/\s+/g, ' ').trim()
      )
    ).toEqual([
      'Insert element…',
      'Copy ID',
      // Carried over from main's ElementTreeContextMenu (#856) when that
      // component was replaced by the ContextMenu primitive.
      'Copy selector',
      'Duplicate⌘D',
      'divider',
      'Cut⌘X',
      'Copy⌘C',
      'Paste⌘V',
      'divider',
      'Delete⌫',
    ]);
    expect(screen.getByText('⌘D')).toBeInTheDocument();
    expect(screen.getByText('⌫')).toBeInTheDocument();
    expect(screen.getByText('⌘X')).toBeInTheDocument();
    expect(screen.getByText('⌘C')).toBeInTheDocument();
    expect(screen.getByText('⌘V')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /^Duplicate ⌘D$/ }));
    expect(selectAndRun).toHaveBeenCalledWith(2, duplicate);

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Cut/ }));
    expect(selectAndRun).toHaveBeenCalledWith(2, cut);

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Copy ⌘C$/ }));
    expect(selectAndRun).toHaveBeenCalledWith(2, copy);

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Paste ⌘V$/ }));
    expect(selectAndRun).toHaveBeenCalledWith(2, paste);

    fireEvent.contextMenu(row);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy ID' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('div.card.featured');

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete ⌫$/ }));
    expect(selectAndRun).toHaveBeenCalledWith(2, remove);
  });

  describe('right-click menu — Copy selector (#856)', () => {
    const structure = {
      selectAndRun: vi.fn((_nodeId: number, run: () => void) => run()),
      insert: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      // Clipboard actions arrived with the new ContextMenu (PR #881); this
      // suite predates them and only exercises "Copy selector".
      copy: vi.fn(),
      cut: vi.fn(),
      paste: vi.fn(),
      hasClipboard: false,
      clipboardSourceNodeId: null,
    };

    function renderTreeWithMenu() {
      render(
        <ElementTreePanel
          tree={{
            id: 1,
            tag: 'body',
            cls: '',
            text: '',
            children: [
              {
                id: 2,
                tag: 'div',
                cls: 'process-engagements__visual-collection',
                text: '',
                children: [],
              },
            ],
          }}
          truncated={false}
          selectedId={null}
          onSelect={vi.fn()}
          onHover={vi.fn()}
          projectPath="/tmp/project"
          selectedSignature={null}
          structure={structure}
        />
      );
      const panel = screen.getByTestId('element-tree-panel');
      const row = panel.querySelector('[data-tree-id="2"]');
      if (!row) throw new Error('row not found');
      fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    }

    it('offers a "Copy selector" action that puts the row\'s tag+class on the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      renderTreeWithMenu();

      // The menu renders through a portal to document.body — `screen` (not a
      // local `container`) is what actually sees it. Confirm it's really
      // there before trusting the click below reached anything.
      const copyItem = screen.getByText('Copy selector');
      expect(copyItem).toBeInTheDocument();

      fireEvent.click(copyItem);

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith('div.process-engagements__visual-collection')
      );
    });

    it('still offers Insert/Duplicate/Delete alongside Copy selector', () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
      renderTreeWithMenu();

      expect(screen.getByText('Insert element…')).toBeInTheDocument();
      expect(screen.getByText('Duplicate')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });
});
