# Plan 001: Build and adopt a Ship Studio-owned drag-and-sort system

> **Executor instructions**: Follow this plan step by step. Run every targeted
> verification command and confirm the expected result before moving to the
> next step. Do not read, copy, translate, vendor, or adapt dnd-kit source code.
> The public documentation and examples linked below are a behavioural reference
> only. All implementation code must be an original design based on this plan
> and Ship Studio's existing architecture. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update this
> plan's status row in `plans/README.md` unless a reviewer says they maintain it.
>
> **Drift check (run first)**:
> `git diff --stat 63ffbcf9..HEAD -- src docs scripts package.json pnpm-lock.yaml`
> and `git status --short`.
> This plan was written while the working tree already contained uncommitted
> changes to `WorkspaceDock.test.tsx`, `WorkspaceHeader.tsx` and its test,
> `WorkspaceLayoutMenu.tsx` and its test, and workspace `dock.css`/`main.css`.
> Preserve those changes. If they are still uncommitted when implementation
> starts, get the operator's direction before editing an overlapping file.

## Status

- **Priority**: P1
- **Effort**: L (multi-stage; expect several PR-sized commits)
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `63ffbcf9`, 2026-09-11

## Why this matters

Ship Studio needs one consistent interaction system for reordering workspace
panels, the Panel Layout menu, pinned projects, CSS variables, and nested page
elements. Implementing pointer handling, collision rules, animation, keyboard
sorting, announcements, cancellation, and auto-scroll separately in each
feature would produce visibly inconsistent behaviour and repeat the exact class
of primitive-level duplication this repository has been removing.

The result of this plan is an original Ship Studio primitive with a stable
application-facing API. It should closely reproduce the visible interaction
qualities demonstrated by dnd-kit's public Sortable examples while retaining
Ship Studio's own state models, source-editing safety rules, design tokens,
portal architecture, tests, and maintenance ownership.

## Non-derivation and reference policy

The target is behaviourally compatible, not source-derived.

- Permitted references:
  - <https://dndkit.com/concepts/sortable/> for observable sortable behaviour,
    grouping, handles, optimistic visual movement, and transition defaults.
  - <https://dndkit.com/concepts/draggable/> for observable drag feedback and
    handle behaviour.
  - <https://dndkit.com/concepts/droppable/> for collision behaviour and nested
    target priority.
  - <https://dndkit.com/concepts/drag-drop-manager/> for the public lifecycle,
    pointer/touch activation, keyboard support, auto-scroll, cancellation, and
    accessibility outcomes.
  - Public interactive examples for manual black-box observation.
- Prohibited references:
  - The dnd-kit GitHub source tree, npm bundle contents, source maps, copied
    tests, type declarations, internal symbol names, or implementation comments.
  - Line-by-line or function-by-function translation, even with renamed symbols.
- Do not add dnd-kit to `package.json`, `pnpm-lock.yaml`, vendored directories,
  or `THIRD_PARTY_NOTICES.md`. No dnd-kit code is being redistributed.
- Use Ship Studio vocabulary (`DragSort`, `DragSortScope`, `useDragSortItem`)
  rather than mirroring upstream class or plugin names.

If legal counsel requires a stricter clean-room process, STOP before Step 1.
Have one person record the behavioural contract and a separate implementer work
only from that contract. This plan is technical guidance, not legal advice.

## Behavioural contract

Write this contract into `docs/internal/drag-sort.md` in Step 1. It is the
source of truth for every integration.

### Lifecycle and activation

1. Use Pointer Events and pointer capture, never native HTML5 `draggable` or
   `DragEvent` APIs.
2. Mouse/trackpad: a press becomes a drag after 4 CSS pixels of movement. A
   press and release below the threshold remains an ordinary click.
3. Touch: require a 250ms hold with at most 5 CSS pixels of movement before
   activation. Scrolling before activation cancels the candidate drag.
4. Pen/other pointers: require a 200ms hold and a 5 CSS pixel tolerance.
5. Ignore interactive descendants (`button`, links, inputs, textareas,
   selects, contenteditable, tabs, and elements with an interactive ARIA role)
   unless that exact element was registered as the drag handle.
6. One scope permits one active operation. A second pointer cannot steal it.
7. `Escape`, `pointercancel`, lost pointer capture, item unmount, scope unmount,
   or window blur cancels and restores the pre-drag order.
8. Releasing over no valid target cancels a pure sortable-list move. A feature
   adapter may explicitly give an outside release another meaning; workspace
   panels use it to float a panel.

### Visual feedback

1. On activation, keep a same-size placeholder in the source position and
   render a body-portaled drag overlay aligned to the grabbed point. The
   original item becomes visually hidden but continues occupying layout.
2. The overlay follows the pointer without pointer-event interception and sits
   at the repository's drag-overlay z-index token. It uses the source's measured
   width/height, current Ship Studio surface styling, and a subtle lift shadow.
3. As the active item crosses an eligible item's midpoint, project the new
   order immediately. Non-active items translate into their projected places
   with CSS transforms; do not physically reparent DOM nodes and do not commit
   application state during pointer movement.
4. Use directional midpoint/closest-centre collision for ordinary lists,
   pointer containment for precise nested targets, and explicit target priority
   when targets overlap.
5. On a valid release, animate the overlay from its current rectangle to the
   final projected rectangle for 250ms with
   `cubic-bezier(0.25, 1, 0.5, 1)`, then clear transient styles. Commit the
   feature mutation exactly once. On cancellation, animate back to the source.
6. If `prefers-reduced-motion: reduce`, skip reorder and settle animation while
   retaining target indicators and state changes.
7. Near a scrollable ancestor's edge, scroll it on animation frames, cap speed,
   prefer the innermost eligible ancestor, and remeasure after every scroll.
   Never scroll the document when the relevant list itself can scroll.
8. Cursor states are `grab` when available and `grabbing` while active. Disable
   text selection only for the duration of an active drag and restore the exact
   previous inline value during cleanup.

### Keyboard and accessibility

1. Every sortable item has a focusable handle. Space or Enter lifts it; arrows
   move the projected target according to the list axis; Home/End move to the
   first/last valid position; Space or Enter drops; Escape cancels.
2. Tree items additionally use Left/Right to choose before/inside/after where
   applicable. Invalid positions are skipped, not announced as successful.
3. Keep focus on the handle throughout and restore it after commit/cancel.
4. The handle exposes an accessible label such as `Move Variables panel` and
   `aria-describedby` points to scope instructions.
5. A polite live region announces lift, each projected position, invalid
   targets, drop, cancellation, and persistence failure. Announcements use
   feature labels, one-based positions, group labels, and totals; never raw IDs.
6. Pointer and keyboard operations call the same projection, validation,
   commit, and rollback functions.

### State and failure semantics

1. IDs must be stable and unique within a scope. Array indices are never IDs.
2. The engine owns only transient interaction state. Feature state remains the
   source of truth and each adapter owns persistence/source mutation.
3. A feature may show projected order optimistically, but an async failure must
   restore the last confirmed order and surface a human-readable toast.
4. While a commit is pending, prevent another drag in that scope. Do not queue
   speculative mutations against stale positions.
5. Changes from another source may replace the confirmed items only while the
   scope is idle. During a drag, defer reconciliation until commit/cancel.

## Current state

- `src/lib/dockDrag.ts` contains workspace-specific rail boundary geometry and
  pure drop application. Preserve this domain knowledge; generic collision
  utilities may replace its measurement mechanics, but `float` versus `dock`
  remains a workspace decision.
- `src/contexts/PanelDockContext.tsx:1-23` already uses small external stores so
  pointer movement does not re-render terminals, preview chrome, and the whole
  workspace at display refresh rate. The new manager must match this pattern.
- `src/components/primitives/DockablePanel.tsx:317-415` currently owns pointer
  capture, the 4px activation threshold, floating-window movement, and panel
  rail drag callbacks. Refactor this only after the generic primitive is proven.
- `src/components/workspace/WorkspaceDock.tsx:1-24` has a load-bearing invariant:
  content stays in a fixed DOM order because reparenting reloads the preview
  iframe and can remount terminals. The generic engine must project movement
  with transforms/order styles, never optimistic DOM insertion.
- `src/lib/workspaceLayout.ts` is the authoritative pure layout model. Panel
  movement still ends in `movePanel`, `setFloating`, and normalized persistence.
- `src/components/workspace/WorkspaceLayoutMenu.tsx:65-119` renders panels in
  rail order but omits the preview row. A sortable version must include a
  non-draggable Preview separator so moving across it changes Left/Right.
- `src/hooks/usePinnedProjects.ts:62-78` already exposes persisted pin reordering.
  `WorkspaceSidebar.tsx:856-908` distinguishes user-ordered Pinned projects from
  Active sessions, which now use a separate feature-owned saved rank list with
  deterministic alphabetical fallback. Both groups remain sortable only within
  their own group.
- `src/components/edit/CssVariablesPanel.tsx:57-110` flattens editable `:root`
  variables even when they originate in different files or different rules.
  Source-safe sorting must group by exact authored rule and may reorder only
  inside one group.
- `src/hooks/useCssVariables.ts` identifies a variable by file, selector line,
  and property and has debounced writes. Pending value saves must finish before
  a declaration move so line-based identities cannot become stale.
- `src/hooks/useElementTree.ts:1-27` receives a rendered DOM snapshot whose
  numeric node IDs are ephemeral. They are suitable for one active gesture,
  not persistence or source mutation.
- `src/hooks/useElementStructure.ts:1-24` and
  `src-tauri/src/commands/edit_structure.rs` provide fail-closed insert,
  duplicate, paste, and delete operations. Element movement must use the same
  source-resolution, drift guards, path validation, logging, and reselect flow.
- Styles use only manifest-ordered tokens. Shared primitive CSS belongs under
  `src/styles/components/` and must be imported by `src/styles/index.css`.
- Shared icons are exported from `@/components/icons`; feature code cannot add
  inline SVG.
- Every user-facing feature contributes an equivalent command through
  `useCommands`. Existing panel move commands live in
  `src/commands/useLayoutCommands.tsx`.

## Target architecture

Create a scoped manager with a small public React surface:

```ts
type DragSortId = string | number;

interface DragSortMove {
  activeId: DragSortId;
  from: { group: DragSortId; index: number };
  to: { group: DragSortId; index: number; placement?: 'before' | 'inside' | 'after' };
  input: 'pointer' | 'keyboard';
}

<DragSortScope
  axis="vertical"
  items={groups}
  canMove={canMove}
  onMove={commitMove}
  announcements={featureCopy}
>
  <DragSortItem id={id} group={group} index={index}>
    <DragSortHandle label={`Move ${label}`} />
    {content}
  </DragSortItem>
</DragSortScope>
```

The exact prop spelling may change if TypeScript exposes a better shape, but
the architectural boundary may not: one scoped manager, registered source and
target elements, external-store transient state, pure projection/collision
functions, feature-owned commits, and no third-party drag dependency.

Use these files so ownership remains clear and LOC stays bounded:

- `src/lib/drag-sort/types.ts` — public types and lifecycle events.
- `src/lib/drag-sort/reorder.ts` — immutable flat/grouped array projection.
- `src/lib/drag-sort/collision.ts` — rectangle measurement and collision ranks.
- `src/lib/drag-sort/autoScroll.ts` — scroll ancestor discovery and rAF loop.
- `src/lib/drag-sort/manager.ts` — registries, sensors, operation lifecycle,
  subscriptions, cleanup, and deferred reconciliation.
- `src/lib/drag-sort/index.ts` — public non-React exports only.
- `src/contexts/DragSortContext.tsx` — scope provider and context guard.
- `src/hooks/useDragSortItem.ts` — item/handle registration and reactive state.
- `src/components/primitives/DragSort.tsx` — `DragSortItem`, handle, overlay,
  instructions and live region.
- `src/styles/components/drag-sort.css` — shared visual states only.
- Colocated `*.test.ts`/`*.test.tsx` files for every module above.

Do not put persistence, workspace panel rules, CSS rewriting, element source
resolution, analytics, or feature copy in the generic layer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Targeted frontend tests | `pnpm test:run -- <test paths>` | selected tests pass |
| Targeted Rust test | `pnpm rust:test <test-name-filter>` | selected tests pass |
| Icons | `pnpm icons:check` | exit 0 |
| Token layers | `pnpm check:token-layers` | exit 0 |
| Patterns | `pnpm check:patterns` | exit 0 |
| LOC | `pnpm check:loc` | exit 0 |
| Full frontend gate | `pnpm test:run` | all tests pass; ask first |
| Full Rust gate | `pnpm rust:test` | all tests pass; ask first |
| Full static gate | `pnpm check:all` | exit 0; ask first |

Repository instruction: never run long test suites without asking. Targeted
tests are permitted. Before final completion, ask the operator for permission
to run the three full CI gates. If permission is declined, report verification
as incomplete and do not declare the entire program done.

## Suggested executor toolkit

- Invoke the `make-interfaces-feel-better` skill, if available, when tuning the
  overlay, projected transforms, target indicators, and reduced-motion states.
- Use `pnpm harness` and the existing fixture harness for visual verification;
  do not infer interaction quality only from component code.
- Read `CLAUDE.md`, `docs/CONTRIBUTING_PATTERNS.md`,
  `docs/design-system.md`, and `docs/flexible-panels.md` fully before editing.

## Scope

### In scope

New foundation and documentation:

- `docs/internal/drag-sort.md`
- `src/lib/drag-sort/**`
- `src/contexts/DragSortContext.tsx`
- `src/hooks/useDragSortItem.ts`
- `src/components/primitives/DragSort.tsx`
- `src/styles/components/drag-sort.css`
- `src/styles/index.css`
- `src/styles/global/token-manifest.json`
- `src/styles/global/tokens-core.css`
- `src/styles/global/tokens-components.css`
- `src/assets/icons/drag-handle.svg`
- `src/components/icons/layout.tsx`
- `src/components/icons/icons.test.tsx`

Workspace panels and menu:

- `src/lib/dockDrag.ts` and its test
- `src/contexts/PanelDockContext.tsx`
- `src/components/primitives/DockablePanel.tsx` and its test
- `src/components/workspace/WorkspaceDock.tsx` and its test
- `src/components/workspace/WorkspaceLayoutMenu.tsx` and its test
- `src/styles/features/workspace/dock.css`
- `src/styles/features/workspace/main.css`
- `src/commands/useLayoutCommands.tsx` and its test, if one exists

Pinned projects:

- `src/hooks/usePinnedProjects.ts` and its test
- `src/hooks/useProjectRail.ts` and its test
- `src/components/workspace/WorkspaceSidebar.tsx` and its test
- `src/components/workspace/HomeSidebar.tsx`
- `src/components/workspace/WorkspaceView.tsx`
- `src/components/AppViewRouter.tsx`
- `src/App.tsx`
- `src/styles/features/workspace/sidebar.css`
- `src/commands/useProjectNumberShortcuts.tsx` or a new focused project-rail
  command hook under `src/commands/`
- `docs/analytics.md` only if a reorder analytics event is introduced

Variables:

- `src/lib/edit-css.ts`
- `src/hooks/useCssVariables.ts` and its test
- `src/components/edit/CssVariablesPanel.tsx` and its test
- `src/components/edit/VariablesPanel.tsx` and its test
- `src-tauri/src/commands/edit_css.rs`
- `src-tauri/src/lib.rs`
- `src/styles/features/css-globals.css`
- a focused Variables command hook under `src/commands/`

Element Navigator:

- `src/components/edit/selectScript.ts` and its test
- `src/hooks/useElementTree.ts` and its test
- `src/hooks/useElementStructure.ts` and its test
- `src/lib/edit-structure.ts` and its test
- `src/components/edit/ElementTreePanel.tsx` and its test
- `src-tauri/src/commands/edit_structure.rs`
- `src-tauri/src/lib.rs`
- `src/styles/features/element-tree.css`
- `src/styles/features/element-structure.css`
- a focused element-structure command hook under `src/commands/`

Harness coverage:

- A new or extended scenario under `src/harness/scenarios/`
- `src/harness/fixtures.ts` only if new Tauri commands require fixtures
- `scripts/harness-capture.mjs` only if interaction capture support is required

### Out of scope

- Any npm drag-and-drop dependency or vendored third-party source.
- Native operating-system file drag/drop in `src/lib/dropTarget.ts`.
- Dashboard project cards and folders.
- Reordering Active workspace sessions; their alphabetical order is deliberate.
- Cross-file or cross-rule CSS-variable movement.
- Moving an element across source files/components.
- Dragging between browser windows or Tauri windows.
- Freeform canvas positioning, resizing, selection rectangles, or timeline
  interactions.
- Renaming plugin-stable CSS classes/tokens.
- Changing panel visibility, width, default-layout, or persistence semantics.

## Git workflow

- Create a feature branch such as `feature/owned-drag-sort` only when the
  operator asks; do not push or open a PR without instruction.
- Prefer one commit per numbered implementation step. Existing commit messages
  are imperative, e.g. `Cover the rail's orchestration, its menu, its commands and its resize`.
- Before each commit, inspect `git diff --stat` and confirm no unrelated dirty
  work was absorbed.

## Steps

### Step 1: Freeze the black-box interaction contract

Create `docs/internal/drag-sort.md` from the Behavioural contract above. Add a
manual observation matrix with rows for mouse, touch emulation, keyboard,
reduced motion, scrolling, cancellation, invalid targets, variable-height
items, horizontal lists, grouped lists, and nested tree targets. For each row,
record initial state, gesture, projected state, release/cancel result, focus,
and announcement. Observe public examples only; do not inspect upstream source.

Record which qualities are exact targets (activation, target switching,
projection timing, settle duration, keyboard lifecycle) and which are rendered
with Ship Studio styling (surface colour, border, shadow, typography).

**Verify**: `rg -n "source code|npm bundle|source map" docs/internal/drag-sort.md`
must show the prohibition; every matrix row above must exist.

### Step 2: Add tokens and the shared drag-handle icon

Add a 250ms sortable-settle duration to the core duration scale only if no
existing primitive is exactly 250ms. Add component tokens for overlay shadow,
overlay opacity, target indicator, transition, and z-index in
`tokens-components.css`, in manifest order. Feature CSS must consume semantic
or component tokens rather than raw colours, spacing, duration, or z-index.

Create a simple six-dot `drag-handle.svg` as original artwork, route it through
the documented temporary icon inbox workflow, normalize it to `currentColor`,
register `DragHandleIcon` in `src/components/icons/layout.tsx`, and consume it
only through `@/components/icons`. Do not copy upstream artwork.

**Verify**: `pnpm icons:check && pnpm check:token-layers` exits 0.

### Step 3: Implement pure reorder and collision functions test-first

Create the `src/lib/drag-sort/` types, reorder, and collision modules. Keep all
DOM-independent behaviour pure:

- Flat and grouped immutable moves using stable IDs.
- Before/inside/after tree projection without mutating a tree.
- Vertical and horizontal midpoint collision.
- Closest-centre fallback for keyboard movement.
- Pointer containment and numeric priority for overlapping nested targets.
- Empty groups, hidden/disabled items, variable-size rectangles, reversed
  movement, no-op moves, and source-removal index compensation.
- A validator callback that returns either an allowed destination or a reason.

Do not use array indexes as identity and do not allow duplicate IDs to resolve
silently; throw a development-time error and disable the production scope with
an accessible error announcement.

**Verify**: `pnpm test:run -- src/lib/drag-sort/reorder.test.ts src/lib/drag-sort/collision.test.ts`
passes all new cases.

### Step 4: Implement the manager, sensors, and React primitive

Build `DragSortManager` as a framework-neutral class using registries and an
external-store snapshot. Register item element, optional handle, target
element, stable ID, group, index, label, type, accepted types, disabled state,
and collision priority. Snapshot changes may rerender only subscribed items,
the overlay, target indicator, instructions, and live region.

Implement pointer candidates and active operations using document/window
listeners installed only while needed. Centralize all cleanup so cancel, drop,
blur, unmount, and exceptions restore pointer capture, selection, cursor, rAF,
scroll subscriptions, overlay nodes, and deferred external items.

Implement keyboard sorting against the same operation state. Never generate a
synthetic pointer event. Implement `autoScroll.ts` independently and have the
manager request remeasurement after scroll/resize.

Create `DragSortScope`, `DragSortItem`, and `DragSortHandle`. The handle is a
raw focusable button owned by this geometry primitive, with the shared icon,
accessible label, described instructions, and correct disabled state. Compose
consumer event handlers rather than overwriting them. React portals remain in
the same context. StrictMode double mount/unmount must leave one registration
and zero leaked listeners.

The overlay should clone rendered content supplied explicitly by the consumer;
never use `cloneNode()` on live React DOM because it loses semantic state and
can duplicate IDs. Use CSS variables set from measured runtime geometry for
coordinates and dimensions; raw runtime pixel values are allowed only for DOM
measurements, not design constants.

**Verify**:

- `pnpm test:run -- src/lib/drag-sort/manager.test.ts src/lib/drag-sort/autoScroll.test.ts src/components/primitives/DragSort.test.tsx`
- Tests must cover the complete lifecycle, thresholds, interactive-child
  exclusion, pointer cancel, lost capture, Escape, blur, unmount, keyboard
  movement, focus restoration, announcements, reduced motion, async commit
  lock, rollback, StrictMode cleanup, and nested portals.

### Step 5: Prove the primitive in the Panel Layout menu

Wrap the menu's arrangement rows in a vertical `DragSortScope`. Render all
`layout.order` entries, including `preview` as a visible, non-draggable locked
separator. Panel rows retain pin/float status and existing left/right buttons;
the drag handle is an additional equivalent interaction, not a replacement.

On projection, show the prospective row order only inside the menu. On drop,
call one `PanelDockContext` operation that accepts the final `RailItem[]`, runs
`normalizeLayout`, preserves `floating` and `widths`, and writes once. Moving a
panel across the Preview separator must update its Left/Right label after
commit. Preview itself cannot move. Keep the dropdown open during drag and
after a successful drop; prevent outside-dismiss logic from interpreting the
portaled overlay as an outside click.

Existing left/right buttons and Cmd+K panel commands remain the non-drag path
and must produce the same final layout as keyboard sorting.

**Verify**: `pnpm test:run -- src/components/workspace/WorkspaceLayoutMenu.test.tsx src/lib/workspaceLayout.test.ts`
passes cases for crossing Preview, floating rows, first/last positions,
cancel/no-op, persistence once, and menu staying open.

### Step 6: Adapt workspace panel dragging without breaking stable content

Refactor only gesture orchestration in `DockablePanel`; retain its floating
position/size, body portal, stacking, viewport clamp, and resize behaviour.
Register panel headers as drag handles with feedback mode `none` so the existing
panel surface—not a cloned overlay—continues following a floating move. Register
workspace rail boundaries as typed panel targets through a workspace adapter.

For docked panels, projected movement may translate/reorder empty dock slots,
but the panel surfaces and preview iframe must remain in their original React
and DOM parents for the entire gesture. Do not physically insert nodes. For a
floating panel, continue updating its local window position while the generic
manager resolves dock targets. An outside drop retains the existing meaning:
docked becomes floating; already-floating stays floating at its released
position. A rail drop calls `movePanel` once.

Keep `dockDrag.ts` as the pure adapter for workspace-specific rail boundaries,
float targets, and human-readable hints unless a narrower extraction becomes
obviously safe. Preserve existing drag-chip and insertion-line copy.

Add regression probes proving:

- the preview iframe DOM node identity is unchanged before/after a reorder;
- terminal/panel children do not unmount;
- only drag subscribers rerender during pointer movement;
- resize and floating-window drags still work;
- clicking a header never floats or reorders it;
- cancellation changes neither layout nor persisted storage.

**Verify**: `pnpm test:run -- src/components/primitives/DockablePanel.test.tsx src/components/workspace/WorkspaceDock.test.tsx src/lib/dockDrag.test.ts`
passes.

### Step 7: Add persisted sorting to Pinned and Active projects

Thread an `onReorderProjects(orderedPaths)` callback from `App.tsx` through
`AppViewRouter`, `HomeSidebar`, and `WorkspaceView` into `WorkspaceSidebar`.
Bind it to `pinnedProjects.reorder`. Active sessions use a separate
feature-owned saved rank list and never cross the Pinned group.

Make Pinned and Active project rows sortable within their own groups. Disable
sorting when the sidebar is compact or a text filter is active, avoiding
hidden-item order corruption and an unusably small handle. Keep expand,
navigation, close/unpin, context-menu,
rename, status, and shortcut behaviour intact. Suppress the click generated at
the end of a drag so dropping never opens a project.

Update `usePinnedProjects.reorder` to apply an optimistic local order, call the
existing validated backend API exactly once, accept the returned canonical
order, and roll back to the confirmed snapshot with a toast/log on failure.
Serialize one commit at a time. Defer registry/refetch reconciliation while a
drag or commit is active.

Register Cmd+K actions to move the current pinned project up/down when valid.
They call the same group-owned reorder function and retain Cmd+1..9 numbering
derived from confirmed Pinned order followed by the saved Active order, with a
deterministic alphabetical fallback for new sessions.

**Verify**: `pnpm test:run -- src/hooks/usePinnedProjects.test.ts src/components/workspace/WorkspaceSidebar.test.tsx`
passes pointer, keyboard, command, rollback, filtered, compact, click
suppression, and shortcut-renumbering cases.

### Step 8: Implement source-safe CSS-variable reordering

First extend `VariableRow` with an explicit authored-rule identity assembled
from data actually returned by the stylesheet index: file, exact selector, and
rule line. Group editable variables by that identity in the Variables panel.
Do not infer rule identity from visual adjacency and do not permit movement
between groups/files in this plan.

Add `reorder_css_variables` to `edit_css.rs` and a typed wrapper in
`src/lib/edit-css.ts`. The command must:

- return `Result<(), CommandError>`, validate `project_path` with
  `validate_project_path()`, use the existing editable-CSS loader/write-back,
  and carry `#[tracing::instrument]` without logging values;
- accept file, selector, rule line, the ordered property names, and an expected
  pre-move fingerprint/order for drift detection;
- resolve exactly one authored rule and exactly one declaration for every
  property; fail closed on missing, duplicate, stale, or extra declarations;
- reorder complete declaration units while preserving raw property/value text,
  indentation, semicolons, blank lines, and comments. Define a leading comment
  block with no intervening blank line as belonging to the following
  declaration; trailing inline comments remain with their declaration;
- change no declarations outside the selected rule and invalidate the CSS
  index cache after a successful write.

Refactor debounced value saves in `useCssVariables` into tracked promises with
a `flushPendingSaves()` operation. A reorder must await successful pending
saves before calling the reorder command. While flushing/committing, lock the
scope. On success reload authoritative definitions; on failure restore the
confirmed UI order, reload, log through `logger`, and show a formatted toast.

Add per-row drag handles without making value fields or menus initiate drags.
Register Move selected variable up/down commands using the same mutation path.

**Verify**:

- `pnpm rust:test reorder_css_variables` passes focused Rust cases for compact,
  multiline, comments, blank lines, missing semicolon, duplicate property,
  stale fingerprint, multiple `:root` blocks, media-scoped roots, and unchanged
  surrounding bytes.
- `pnpm test:run -- src/hooks/useCssVariables.test.ts src/components/edit/CssVariablesPanel.test.tsx src/components/edit/VariablesPanel.test.tsx`
  passes flush-before-reorder, grouping, invalid cross-group target, rollback,
  keyboard, and interactive-child cases.

### Step 9: Implement fail-closed Element Navigator movement

Extend the iframe protocol with a request that resolves both the drag source
node and target node from their current ephemeral IDs at drop time and returns
their real `ElementSignature` plus exact current HTML. Trust replies only from
the active preview iframe, matching the existing source check. Do not persist
node IDs or assume that a pre-drag snapshot still maps after HMR.

Add `move_element` to `edit_structure.rs` and a wrapper in
`src/lib/edit-structure.ts`. The command must locate source and target using the
existing conservative resolution, require both to resolve into the same source
file, compare both exact HTML snapshots as drift guards, and reject:

- source equals target;
- target lies inside the source span;
- `<html>`, `<head>`, or `<body>` movement;
- `inside` on a void element;
- a sibling beside the outer JSX root;
- a move that would create invalid/ambiguous markup;
- cross-file/component movement.

For an allowed before/after/inside move, remove the complete source span,
recompute the target offset after removal, reindent the moved subtree to its
new authored depth without changing internal relative indentation, perform one
atomic file write, invalidate the source index, and return enough truthful data
for the existing reselect flow. Never implement move as independent delete and
insert writes; a crash between them would lose user code.

In `ElementTreePanel`, make rows grouped sortables with three pointer zones:
top quarter = before, middle half = inside when valid, bottom quarter = after.
Give the specific zone higher priority than the row/container. Draw an
indentation-aware insertion line for before/after and a contained highlight for
inside. After 600ms over a valid collapsed container, expand it without
committing tree state. Auto-scroll the tree body near its edges. Invalid
descendant/void/root/cross-component targets remain visibly unavailable and
announce why.

Projected tree changes are visual only. At drop, set `busy`, resolve fresh
source/target data, execute the one backend command, retain/reselect the moved
element after HMR, and request a fresh tree. On failure restore the snapshot,
use `structuralEditMessage`/expected-refusal logging rules, and never leave the
tree showing an order not present in source.

Register Move selected element up/down (within siblings) Cmd+K actions and
make them call the same backend move path. Keyboard drag mode must additionally
support before/inside/after so it is equivalent to pointer interaction.

**Verify**:

- `pnpm rust:test move_element` passes same-parent reorder, move into container,
  move out, before/after offset reversal, multiline reindent, inline markup,
  comments, JSX, structural roots, void targets, own-descendant, cross-file,
  ambiguous signatures, and stale source/target guards.
- `pnpm test:run -- src/components/edit/selectScript.test.ts src/hooks/useElementTree.test.ts src/hooks/useElementStructure.test.ts src/components/edit/ElementTreePanel.test.tsx`
  passes pointer zones, hover expansion, auto-scroll, invalid targets,
  cancellation, fresh-resolution-before-write, HMR refresh, rollback,
  keyboard placement, announcements, and command actions.

### Step 10: Add visual harness coverage and polish consistently

Add a deterministic fixture scenario containing enough panels, pinned projects,
variables, and nested elements to exercise scrolling and variable sizes. Every
new Tauri command must have an exact fixture response; an unmocked harness badge
invalidates the capture.

Manually compare the implementation against the Step 1 matrix at ordinary and
reduced motion settings. Inspect at least:

- smooth projected gaps without list-height collapse;
- overlay alignment from a non-centre grab point;
- no one-frame flash at activation or settle;
- target changes exactly when the pointer crosses the intended midpoint/zone;
- scrolling maintains pointer-to-overlay alignment;
- drop/cancel focus restoration and live announcements;
- dense 184–240px panels without clipped handles or labels;
- no unexpected preview reload or terminal remount.

Use Ship Studio design tokens for appearance; behavioural similarity does not
mean copying dnd-kit's colours, typography, shadows, or iconography.

**Verify**: run `pnpm harness` and capture only the new scenario or focused
states. The report must contain no unmocked-command badge, overflow warning, or
console error. Save no generated screenshots unless the repository convention
for that scenario explicitly tracks them.

### Step 11: Run static gates, then request permission for full suites

Run the non-long checks first:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm icons:check
pnpm check:tokens
pnpm check:token-layers
pnpm check:patterns
pnpm check:loc
```

All must exit 0. Then ask the operator before running `pnpm check:all`,
`pnpm test:run`, and `pnpm rust:test`. If approved, all three must pass before
marking the plan DONE. If a gate exposes unrelated pre-existing failure, record
the exact command and failure without modifying unrelated code.

## Test plan

The step-level tests are mandatory. Across them, ensure coverage of:

- Pure projection and collision for flat, grouped, horizontal, and tree data.
- Pointer, touch, pen, and keyboard activation/cancellation.
- Variable item sizes, scrolled ancestors, window resize, reduced motion, and
  overlapping targets.
- React StrictMode, portals, unmount during drag, nested interactive controls,
  focus restoration, live-region copy, and no leaked listeners/rAF work.
- Sync and async commits, one commit per drop, no-op drops, stale external data,
  rollback, and commit locking.
- Every feature adapter's domain invariants and persistence/source-write errors.
- Existing non-drag alternatives: panel buttons/commands, project navigation,
  variable editing, tree selection/context menu, panel float/resize.

Do not use snapshots as the primary proof. Assert positions/order, state
transitions, command arguments, storage/backend writes, announcements, focus,
and cleanup explicitly.

## Done criteria

- [x] No dnd-kit package, vendored file, copied source, source-derived symbol,
      or third-party notice was added.
- [ ] `docs/internal/drag-sort.md` contains the black-box behavioural contract
      and completed observation/verification matrix.
- [ ] One scoped, dependency-free DragSort engine serves all integrations.
- [ ] Pointer, touch, pen, keyboard, cancellation, reduced motion, auto-scroll,
      accessibility announcements, overlays, projection, settle animation, and
      async rollback have automated coverage.
- [x] Panel Layout rows reorder around a locked Preview separator and persist
      through the existing normalized layout model.
- [ ] Workspace panels reuse the engine without reparenting/remounting the
      preview iframe or terminal content; dock/float/resize semantics remain.
- [ ] Pinned and Active projects reorder only within their own group;
      filtering, compact mode, navigation, context menus, persistence,
      and Cmd+number behaviour remain correct.
- [ ] Variables reorder only within one explicit authored rule after pending
      saves flush; source formatting/comments and unrelated bytes are preserved.
- [ ] Elements move atomically within one source file with fresh source/target
      resolution, drift guards, invalid-target rules, reindentation, rollback,
      HMR refresh, and reselect.
- [ ] Every pointer operation has a keyboard path and relevant Cmd+K actions.
- [x] All new styling uses correctly layered tokens and the shared icon system.
- [ ] Focused tests and harness checks pass with no unmocked commands, console
      errors, leaked handlers, or overflow warnings.
- [ ] With operator approval, `pnpm check:all`, `pnpm test:run`, and
      `pnpm rust:test` all exit 0.
- [ ] `git diff --check` exits 0 and `git status --short` lists only intentional
      in-scope changes plus preserved pre-existing user changes.
- [ ] The row for Plan 001 in `plans/README.md` is updated to DONE only after
      every applicable criterion above holds.

## STOP conditions

Stop and report instead of improvising if:

- Relevant uncommitted user changes still overlap the implementation and their
  ownership/integration has not been clarified.
- Anyone proposes inspecting or translating upstream source to finish the work.
- Matching an observed behaviour would require a third-party dependency.
- The generic manager begins acquiring panel, project, CSS, or element-specific
  persistence/source logic.
- A panel reorder requires moving the preview iframe or live terminal DOM node.
- Pinned-project sorting would require changing Active-session ordering.
- A variable destination is in another file/rule, or the command cannot
  associate comments and declarations without ambiguity.
- An element source and target resolve to different files/components, either
  signature is ambiguous/stale, or atomic same-file movement cannot be proven.
- The iframe protocol cannot return fresh source/target signatures without
  weakening its `contentWindow` trust check.
- A new Rust command cannot meet `CommandError`, `validate_project_path`,
  tracing, drift guard, single-write, and focused-test requirements.
- Any step's focused verification fails twice after a reasonable correction.
- Completing a step requires touching an out-of-scope domain.
- Full CI permission is withheld; leave the plan IN PROGRESS with verification
  outstanding rather than claiming completion.

## Maintenance notes

- Treat `docs/internal/drag-sort.md` as the stable product contract. New sortable
  features should select existing engine options and define their commit adapter;
  they should not add feature conditionals to the manager.
- Reviewers should scrutinize cleanup paths, ID stability, portal behaviour,
  stale async commits, listener/rAF leaks, keyboard parity, live announcements,
  source drift checks, and byte preservation more closely than visual polish.
- If another use case needs cross-group or cross-file semantics, design its data
  transaction separately. The engine can describe the destination, but it must
  never decide whether a domain mutation is safe.
- Future changes to panel layout must preserve fixed content identity. Future
  variable parsing must retain explicit rule identity. Future element-tree wire
  changes must continue treating node IDs as ephemeral.
- Do not promise perpetual pixel-for-pixel identity with an evolving external
  demo. Ship Studio owns the frozen behavioural contract recorded in Step 1.
