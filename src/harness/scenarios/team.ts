/**
 * Team — multiplayer, captured.
 *
 * `get_team_snapshot` reads a real repository: git history, `gh pr list`, and
 * any records under `.shipstudio-team/`. A capture machine has none of those —
 * no teammates, no pull requests, usually no remote — so these scenarios answer
 * that one command from `harness/fixtures/team`, which is the only invented
 * data left anywhere in the feature.
 *
 * Each reaches its surface through the palette rather than through `steps`,
 * because the harness runs scripted steps *before* `command` — a step cannot
 * click a control that only exists after the command has navigated. Every
 * command landing on its own tab is the right product behaviour anyway.
 *
 * `requires` names something only the intended surface renders, so a capture
 * that lands somewhere else fails the run instead of quietly photographing the
 * wrong screen.
 */

import type { Scenario } from '../types';
import { workspaceCommands, WORKSPACE_PROJECT } from './workspace';
import { buildTeamFixture } from '../fixtures/team';

/**
 * The one command every Team surface calls.
 *
 * Answered per invocation rather than as a frozen literal, so the fixture
 * adopts whichever project the scenario opened. The screens are about *your*
 * project with people in it, and a fixture naming a repo nobody has heard of
 * would photograph the wrong idea.
 */
const teamCommands = {
  get_team_snapshot: (args: Record<string, unknown>) => {
    const projectPath = typeof args.projectPath === 'string' ? args.projectPath : WORKSPACE_PROJECT;
    return buildTeamFixture({
      projectPath,
      projectName: projectPath.split('/').pop() || 'your project',
    });
  },
  // The home-level screen reads across recently opened projects, so it needs
  // the list before it can read anything at all.
  get_dashboard_projects: [
    { name: 'acme-marketing', path: WORKSPACE_PROJECT, thumbnail: null, last_opened: null },
  ],
};

export const teamScenarios: Scenario[] = [
  {
    id: 'team-coverage',
    title: 'Team — the half of the team who are not in Ship Studio',
    looksRightWhen:
      'The coverage note names who pushes straight to GitHub, says exactly what is missing from their rows (the why, not the fact), and offers one action. It is a footnote after the feed, not a banner in front of it.',
    project: WORKSPACE_PROJECT,
    openSelector: '.team-presence',
    requires: '.team-coverage',
    clipSelector: '.team-coverage',
    commands: { ...workspaceCommands, ...teamCommands },
  },

  {
    id: 'team-in-workspace',
    title: 'Team — inside the project you are working in',
    looksRightWhen:
      'The workspace header carries a face stack with a count of what has landed since you last looked, and the panel floats over the preview showing what people actually did — headline, why, what changed — rather than a list of pushes.',
    project: WORKSPACE_PROJECT,
    openSelector: '.team-presence',
    requires: '.team-update-headline',
    commands: { ...workspaceCommands, ...teamCommands },
  },
  {
    id: 'team-in-workspace-people',
    title: 'Team — who is on what, without leaving the project',
    looksRightWhen:
      'Each teammate shows the branch they are on and the sentence describing what they are doing, not just a branch name and a timestamp.',
    project: WORKSPACE_PROJECT,
    openSelector: '.team-presence',
    steps: [{ click: '[data-tab-value="people"]' }],
    requires: '.team-person-doing',
    commands: { ...workspaceCommands, ...teamCommands },
  },

  {
    id: 'team-activity',
    title: 'Team — what everyone did',
    looksRightWhen:
      'Every row leads with a sentence you can act on, with the reasoning underneath and the commits collapsed behind one line. The single row Ship Studio wrote itself — a push with no agent summary attached — is visibly the lesser thing, which is the argument for the skill made in the UI rather than in a doc.',
    command: 'team.updates',
    requires: '.team-update-headline',
    commands: { ...teamCommands },
  },
  {
    id: 'team-people',
    title: 'Team — who is on what',
    looksRightWhen:
      'Each person shows a branch, how far ahead it is, and when they last pushed — never an "online" dot, because no remote can report that. The collaborator who has pushed nothing says so instead of being hidden, and the footnote names what a git remote cannot see.',
    command: 'team.people',
    requires: '.team-person',
    commands: { ...teamCommands },
  },
  {
    id: 'team-comments',
    title: 'Team — comment threads',
    looksRightWhen:
      'A list driving a reader beside it, the same geometry as the Inbox. A thread shows its pin number, its participants and its route; the reader shows the conversation and a composer whose hint says replies are pushed on the next sync.',
    command: 'team.comments',
    requires: '.team-message',
    commands: { ...teamCommands },
  },
  {
    id: 'team-how-it-works',
    title: 'Team — how this works',
    looksRightWhen:
      'The disclosure panel that replaces an onboarding step: the exact path written into the repo, the three writers ranked by how much each can be relied on, and the three limits — not live, not an audit log, not private.',
    command: 'team.howItWorks',
    requires: '.team-how-limits',
    commands: { ...teamCommands },
  },
];
