/**
 * Webflow migration scenarios.
 *
 * The Fidelity panel reads captures written by `scripts/webflow-fidelity.mjs`
 * and served from `public/webflow-demo`, so these need no command fixtures for
 * the data itself — the run on disk *is* the fixture, and it is a real one:
 * real screenshots of a real Webflow template against a rebuild with real
 * mistakes in it. That is the point of the panel, so faking it here would
 * defeat the review.
 */

import type { Scenario } from '../types';
import { workspaceCommands, WORKSPACE_PROJECT } from './workspace';

export const webflowScenarios: Scenario[] = [
  {
    id: 'webflow-fidelity',
    command: 'webflow.fidelity',
    requires: '.wf-matrix',
    title: 'Webflow — fidelity against the original',
    looksRightWhen:
      'The worst breakpoint leads, and it is the worst rather than an average. Every compared cell carries a number; the templates nobody has compared say so in words instead of showing a score. The history shows the loop moving 89 → 100 with the fix that moved it.',
    project: WORKSPACE_PROJECT,
    commands: {
      ...workspaceCommands,
      // Asked for by the preview toolbar the moment a workspace mounts. Not
      // this panel's concern, but an unanswered command fails the capture, and
      // a screenshot from a run with unmocked commands is not evidence.
      get_element_breadcrumb_enabled: false,
    },
  },
  // The Overlay and Difference views have no scenario, and cannot yet: the
  // harness runs a scenario's `steps` *before* its `command`, so a step can
  // never click a control inside a modal that the command is what opens. Both
  // views are reachable by hand; see prototypes/webflow-fidelity/README.md.
  {
    id: 'webflow-import',
    command: 'webflow.import',
    requires: '.wf-import__tiers',
    title: 'Webflow — choosing where to read the site from',
    looksRightWhen:
      'Three tiers, and each states what it cannot bring across as prominently as what it can. Nothing here implies the .zip carries CMS content.',
    // Opens from the dashboard, so it needs no workspace fixtures — but the
    // harness requires the key, and an empty map is the honest way to say
    // "this surface asks the backend for nothing".
    commands: {},
  },
];
