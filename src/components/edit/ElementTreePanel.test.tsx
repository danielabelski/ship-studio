import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ElementTreePanel } from './ElementTreePanel';

describe('ElementTreePanel', () => {
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
    expect(panel.querySelector('[data-tree-id="3"] .ss-tree-tag')).toHaveTextContent('main');
  });

  describe('right-click menu — Copy selector (#856)', () => {
    const structure = {
      selectAndRun: vi.fn((_nodeId: number, run: () => void) => run()),
      insert: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
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
