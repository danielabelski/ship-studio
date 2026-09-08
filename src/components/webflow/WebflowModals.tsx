/**
 * The Webflow migration surfaces, mounted once at app level.
 *
 * Both are reachable from anywhere — the source picker belongs to the
 * dashboard's import flow and the Fidelity panel to a workspace — so they are
 * mounted here rather than inside either view, for the same reason Help and
 * Changelog are: a palette command that opens a modal whose consumer is not in
 * the tree is a command that silently does nothing.
 */

import { useModal } from '../../contexts/ModalContext';
import { useOptionalToast } from '../../contexts/ToastContext';
import { ModalFrame } from '../primitives/ModalFrame';
import { FidelityPanel } from './FidelityPanel';
import { WebflowImportModal } from './WebflowImportModal';

/**
 * Where the prototype reads its comparison from.
 *
 * A directory of captures written by `scripts/webflow-fidelity.mjs` and served
 * statically. The shipped version resolves this from the open project, which
 * is why the panel takes it as a prop rather than reaching for it.
 */
const DEMO_RUN = '/webflow-demo';

export function WebflowModals() {
  const fidelity = useModal('webflowFidelity');
  const importSource = useModal('webflowImport');
  const toast = useOptionalToast();

  return (
    <>
      <ModalFrame
        isOpen={fidelity.isOpen}
        onClose={fidelity.close}
        title="Fidelity"
        className="wf-modal"
      >
        <FidelityPanel source={DEMO_RUN} />
      </ModalFrame>

      <WebflowImportModal
        isOpen={importSource.isOpen}
        onClose={importSource.close}
        onConfirm={(kind) => {
          importSource.close();
          // Nothing behind this yet — the ingest is the next piece of work, and
          // a button that quietly does nothing is worse than one that says so.
          toast.showToast(`Not wired up yet: ${kind}`, 'info');
        }}
      />
    </>
  );
}
