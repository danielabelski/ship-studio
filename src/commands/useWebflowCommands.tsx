/**
 * Palette entries for the Webflow migration surfaces.
 *
 * Registered here rather than left to a toolbar button because the palette is
 * the app's own inventory of what it can do — and because the UI harness
 * sweeps that registry to screenshot every feature, so a command is also how
 * this gets visual coverage.
 */

import { GlobeIcon, LayersIcon } from '@/components/icons';
import { useCommands } from './useCommands';
import { useOpenModal } from '../contexts/ModalContext';

export function useWebflowCommands() {
  const openModal = useOpenModal();

  useCommands(
    () => [
      {
        id: 'webflow.import',
        title: 'Bring in a Webflow site…',
        icon: <GlobeIcon size={14} />,
        category: 'project',
        when: 'home',
        keywords: ['webflow', 'migrate', 'import', 'convert', 'export'],
        run: () => openModal('webflowImport'),
      },
      {
        id: 'webflow.fidelity',
        title: 'Check fidelity against Webflow',
        icon: <LayersIcon size={14} />,
        category: 'project',
        keywords: ['webflow', 'fidelity', 'compare', 'diff', 'pixel', 'match', 'migration'],
        run: () => openModal('webflowFidelity'),
      },
    ],
    [openModal]
  );
}
