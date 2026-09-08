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
import { SiteUrlPanel } from './SiteUrlPanel';

/**
 * Where the prototype reads its comparison from.
 *
 * A directory of captures written by `scripts/webflow-fidelity.mjs` and served
 * statically. The shipped version resolves this from the open project, which
 * is why the panel takes it as a prop rather than reaching for it.
 */
const DEMO_RUN = '/migration-demo';

export function MigrationModals() {
  const fidelity = useModal('migrationFidelity');
  const importSource = useModal('siteUrlImport');
  const toast = useOptionalToast();

  return (
    <>
      <ModalFrame
        isOpen={fidelity.isOpen}
        onClose={fidelity.close}
        title="Migration"
        className="mig-modal"
      >
        <FidelityPanel source={DEMO_RUN} />
      </ModalFrame>

      <SiteUrlPanel
        isOpen={importSource.isOpen}
        onClose={importSource.close}
        onStart={(url) => {
          importSource.close();
          // Nothing behind this yet — scaffolding the project and handing the
          // URL to the agent is the next piece of work. A button that quietly
          // does nothing is worse than one that says so.
          toast.showToast(`Not wired up yet — would start a migration of ${url}`, 'info');
        }}
      />
    </>
  );
}
