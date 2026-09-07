/**
 * Team — the multiplayer vision prototype.
 *
 * These scenarios add no `commands` of their own, because the Team screens do
 * not call the backend yet: their data comes from `lib/teamFixtures`, in the
 * frontend. That is the point of the prototype, and it is also why these
 * captures are worth having — the whole feature is UI right now, so UI is the
 * only thing there is to review.
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

export const teamScenarios: Scenario[] = [
  {
    id: 'team-in-workspace',
    title: 'Team — inside the project you are working in',
    looksRightWhen:
      'The workspace header carries a face stack with a count of what has landed since you last looked, and the panel floats over the preview showing what people actually did — headline, why, what changed — rather than a list of pushes.',
    project: WORKSPACE_PROJECT,
    openSelector: '.team-presence',
    requires: '.team-update-headline',
    commands: { ...workspaceCommands },
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
    commands: { ...workspaceCommands },
  },

  {
    id: 'team-activity',
    title: 'Team — what everyone did',
    looksRightWhen:
      'Every row leads with a sentence you can act on, with the reasoning underneath and the commits collapsed behind one line. The single row Ship Studio wrote itself — a push with no agent summary attached — is visibly the lesser thing, which is the argument for the skill made in the UI rather than in a doc.',
    command: 'team.updates',
    requires: '.team-update-headline',
    commands: {},
  },
  {
    id: 'team-people',
    title: 'Team — who is on what',
    looksRightWhen:
      'Each person shows a branch, how far ahead it is, and when they last pushed — never an "online" dot, because no remote can report that. The collaborator who has pushed nothing says so instead of being hidden, and the footnote names what a git remote cannot see.',
    command: 'team.people',
    requires: '.team-person',
    commands: {},
  },
  {
    id: 'team-comments',
    title: 'Team — comment threads',
    looksRightWhen:
      'A list driving a reader beside it, the same geometry as the Inbox. A thread shows its pin number, its participants and its route; the reader shows the conversation and a composer whose hint says replies are pushed on the next sync.',
    command: 'team.comments',
    requires: '.team-message',
    commands: {},
  },
  {
    id: 'team-how-it-works',
    title: 'Team — how this works',
    looksRightWhen:
      'The disclosure panel that replaces an onboarding step: the exact path written into the repo, the three writers ranked by how much each can be relied on, and the three limits — not live, not an audit log, not private.',
    command: 'team.howItWorks',
    requires: '.team-how-limits',
    commands: {},
  },
];
