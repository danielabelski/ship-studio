/**
 * The site-migration surfaces, mounted once at app level.
 *
 * The URL panel belongs to the dashboard and the Migration panel to a
 * workspace, so they are mounted here rather than inside either view, for the
 * same reason Help and Changelog are: a palette command that opens a modal
 * whose consumer is not in the tree is a command that silently does nothing.
 */

import { useModal } from '../../contexts/ModalContext';
import { usePaletteContext } from '../CommandPalette/paletteContext';
import { ModalFrame } from '../primitives/ModalFrame';
import { FidelityPanel } from './FidelityPanel';

export function MigrationModals() {
  const fidelity = useModal('migrationFidelity');
  const ctx = usePaletteContext();
  const projectPath = ctx.currentProjectPath ?? null;

  return (
    <>
      <ModalFrame
        isOpen={fidelity.isOpen}
        onClose={fidelity.close}
        title="Migration"
        className="mig-modal"
      >
        {projectPath ? (
          <FidelityPanel projectPath={projectPath} />
        ) : (
          // Reached from the dashboard, where there is no project to report on.
          // Saying so beats an empty panel that reads as a broken feature.
          <p className="mig-panel__hint">Open a project to see its migration.</p>
        )}
      </ModalFrame>
    </>
  );
}
