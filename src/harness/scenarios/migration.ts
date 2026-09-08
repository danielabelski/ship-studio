/**
 * Site-migration scenarios.
 *
 * The panel reads captures written by `scripts/webflow-fidelity.mjs` and served
 * from `public/migration-demo`, so these need no command fixtures for the data
 * itself — the run on disk *is* the fixture, and it is a real one: real
 * screenshots of a real site against a rebuild with real mistakes in it. That
 * is the point of the panel, so faking it here would defeat the review.
 */

import type { Scenario } from '../types';
import { workspaceCommands, WORKSPACE_PROJECT } from './workspace';

export const migrationScenarios: Scenario[] = [
  {
    id: 'migration-fidelity',
    command: 'migration.fidelity',
    requires: '.mig-matrix',
    title: 'Migration — where the work actually is',
    looksRightWhen:
      'The phase rail shows the method and where the agent is inside it. The open question is unmissable, because while one is open the migration is stopped, not slow. Done / Doing / Not done / Can\u2019t carry all render even when empty. The worst breakpoint leads, never an average, and untouched templates say so in words instead of showing a score.',
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
    id: 'migration-import',
    command: 'migration.import',
    requires: '.mig-url__steps',
    title: 'Migration — starting from a URL',
    looksRightWhen:
      'One field. The five phases are stated before the user commits, in the order the skill runs them, and the two promises — nothing called done unmeasured, nothing dropped silently — are on screen rather than implied.',
    // Opens from the dashboard, so it needs no workspace fixtures — but the
    // harness requires the key, and an empty map is the honest way to say
    // "this surface asks the backend for nothing".
    commands: {},
  },
];
