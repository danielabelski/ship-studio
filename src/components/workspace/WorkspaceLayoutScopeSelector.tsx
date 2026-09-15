import { Tabs, TabsList, TabsTab } from '../primitives/Tabs';
import { usePanelDock } from '../../contexts/PanelDockContext';
import type { LayoutScope } from '../../lib/workspaceLayoutStore';

/** The persistence scope control shared by both Panel Layout menu variants. */
export function WorkspaceLayoutScopeSelector() {
  const { layoutScope, setLayoutScope } = usePanelDock();

  return (
    <div className="workspace-layout-menu__scope">
      <span className="workspace-layout-menu__scope-label">Layout applies to</span>
      <Tabs
        value={layoutScope}
        size="default"
        mode="navigation"
        onValueChange={(next) => setLayoutScope(next as LayoutScope)}
        className="workspace-layout-menu__scope-tabs"
      >
        <TabsList aria-label="Layout applies to">
          <TabsTab value="project">This project</TabsTab>
          <TabsTab value="global">All projects</TabsTab>
        </TabsList>
      </Tabs>
    </div>
  );
}
