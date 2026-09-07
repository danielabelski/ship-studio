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

export const teamScenarios: Scenario[] = [
  {
    id: 'team-activity',
    title: 'Team — activity log',
    looksRightWhen:
      'Rows group under Today/Yesterday, each showing who did what with a category badge. Only the git-derived rows carry the quiet "from git" marker; the rest go without rather than claiming an assurance they do not have. The failed deploy shows its build error on the second line.',
    command: 'team.activity',
    requires: '.team-event',
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
