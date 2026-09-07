/**
 * Fixture data for the Team prototype.
 *
 * PROTOTYPE ONLY. Every person, commit SHA, PR number and comment below is
 * invented. This file exists so the Team screens can be looked at and clicked
 * through before a line of git plumbing is written, and it is the first thing
 * deleted when `teamStore` starts reading real events.
 *
 * It is a separate module from the store on purpose: when the store is wired
 * to the backend, this file is removed and nothing else changes shape. Two
 * rules keep that true —
 *
 * 1. Nothing here is generated at import time from anything a real backend
 *    could not also produce. Timestamps are offsets from a fixed `now` so the
 *    feed reads sensibly whenever it is opened.
 * 2. `avatarUrl` is null for everyone. A real GitHub avatar is a network image;
 *    inventing URLs here would photograph a broken image in the UI harness and
 *    tell us nothing. The initials treatment is the design for a missing
 *    avatar, so the fixtures exercise the path that actually has to be good.
 *
 * @module lib/teamFixtures
 */

import type { TeamActor, TeamEvent, TeamMember, TeamSnapshot, TeamThread } from './team';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const actor = (login: string, name: string): TeamActor => ({ login, name, avatarUrl: null });

export const FIXTURE_ACTORS = {
  self: actor('juliangalluzzo', 'Julian Galluzzo'),
  maya: actor('mayareed', 'Maya Reed'),
  jordan: actor('jordanchen', 'Jordan Chen'),
  enid: actor('enidshah', 'Enid Shah'),
  sarah: actor('sarahpark', 'Sarah Park'),
  /** Someone who has committed but never signed in to Ship Studio. */
  contractor: { login: null, name: 'dev@contractor.io', avatarUrl: null } as TeamActor,
};

const MARKETING = '/Users/harness/ShipStudio/acme-marketing';
const DASHBOARD = '/Users/harness/ShipStudio/clarity-dashboard';

/** Builds the snapshot relative to a `now`, so ages read correctly on open. */
export function buildTeamFixture(now = Date.now()): TeamSnapshot {
  const at = (ms: number) => now - ms;

  let seq = 0;
  const event = (
    ms: number,
    partial: Omit<TeamEvent, 'id' | 'at' | 'projectName' | 'projectPath'> &
      Partial<Pick<TeamEvent, 'projectName' | 'projectPath'>>
  ): TeamEvent => {
    seq += 1;
    return {
      id: `01K4J8Q2${String(seq).padStart(4, '0')}`,
      at: at(ms),
      projectName: 'acme-marketing',
      projectPath: MARKETING,
      ...partial,
    };
  };

  const events: TeamEvent[] = [
    event(3 * MINUTE, {
      actor: FIXTURE_ACTORS.maya,
      kind: 'commit.pushed',
      source: 'git',
      branch: 'feat/pricing-tiers',
      summary: 'pushed 3 commits to feat/pricing-tiers',
      detail: 'Rework the tier cards to a 3-up grid at ≥1024px',
      refs: [
        { kind: 'commit', label: 'a3f2c81' },
        { kind: 'branch', label: 'feat/pricing-tiers' },
      ],
    }),
    event(11 * MINUTE, {
      actor: FIXTURE_ACTORS.jordan,
      kind: 'comment.added',
      source: 'event',
      branch: 'feat/pricing-tiers',
      summary: 'left a comment on the pricing hero',
      detail: '“This headline wraps to three lines on a 390px screen.”',
      refs: [{ kind: 'file', label: 'src/pages/pricing.astro' }],
    }),
    event(24 * MINUTE, {
      actor: FIXTURE_ACTORS.self,
      kind: 'agent.session',
      source: 'event',
      branch: 'fix/nav-overflow',
      summary: 'ran an agent session on fix/nav-overflow',
      detail: 'Claude Code · 14 files read, 3 edited, 6m 20s',
      refs: [{ kind: 'branch', label: 'fix/nav-overflow' }],
    }),
    event(48 * MINUTE, {
      actor: FIXTURE_ACTORS.enid,
      kind: 'deploy.failed',
      source: 'event',
      branch: 'main',
      summary: 'pushed main — the Vercel build failed',
      detail: "Type error: Property 'tier' does not exist on type 'Plan'. (src/lib/plans.ts:42)",
      refs: [
        { kind: 'commit', label: '77b0e14' },
        { kind: 'url', label: 'Vercel build log', href: 'https://vercel.com' },
      ],
    }),
    event(1 * HOUR + 20 * MINUTE, {
      actor: FIXTURE_ACTORS.sarah,
      kind: 'pr.opened',
      source: 'git',
      branch: 'feat/locale-switcher',
      summary: 'opened pull request #142',
      detail: 'Add a locale switcher to the marketing header',
      refs: [{ kind: 'pr', label: '#142', href: 'https://github.com' }],
    }),
    event(2 * HOUR, {
      actor: FIXTURE_ACTORS.maya,
      kind: 'finding.filed',
      source: 'event',
      branch: 'main',
      projectName: 'clarity-dashboard',
      projectPath: DASHBOARD,
      summary: 'filed 2 findings from Dependency drift',
      detail: '1 critical, 1 warning — `undici` advisory has a published fix',
      refs: [{ kind: 'file', label: 'pnpm-lock.yaml' }],
    }),
    event(3 * HOUR + 10 * MINUTE, {
      actor: FIXTURE_ACTORS.jordan,
      kind: 'workflow.ran',
      source: 'event',
      branch: 'main',
      summary: 'ran Pre-release check',
      detail: 'Read-only · found nothing',
      refs: [{ kind: 'file', label: '.shipstudio/workflows/pre-release.md' }],
    }),
    event(5 * HOUR, {
      actor: FIXTURE_ACTORS.self,
      kind: 'comment.resolved',
      source: 'event',
      branch: 'feat/pricing-tiers',
      summary: 'resolved a comment on the FAQ accordion',
      detail: null,
      refs: [{ kind: 'file', label: 'src/components/Faq.astro' }],
    }),
    event(DAY + 2 * HOUR, {
      actor: FIXTURE_ACTORS.enid,
      kind: 'pr.merged',
      source: 'git',
      branch: 'main',
      summary: 'merged pull request #138 into main',
      detail: 'Replace the hand-rolled carousel with a CSS scroll-snap rail',
      refs: [
        { kind: 'pr', label: '#138', href: 'https://github.com' },
        { kind: 'commit', label: '4c19ba0' },
      ],
    }),
    event(DAY + 3 * HOUR, {
      actor: FIXTURE_ACTORS.contractor,
      kind: 'commit.pushed',
      source: 'git',
      branch: 'main',
      summary: 'pushed 1 commit to main',
      detail: 'Fix the footer copyright year',
      refs: [{ kind: 'commit', label: 'e0aa2f7' }],
    }),
    event(DAY + 6 * HOUR, {
      actor: FIXTURE_ACTORS.maya,
      kind: 'deploy.succeeded',
      source: 'event',
      branch: 'main',
      summary: 'pushed main — Vercel deployed it',
      detail: 'Ready in 48s',
      refs: [{ kind: 'commit', label: '4c19ba0' }],
    }),
    event(2 * DAY + 4 * HOUR, {
      actor: FIXTURE_ACTORS.sarah,
      kind: 'branch.created',
      source: 'git',
      branch: 'feat/locale-switcher',
      summary: 'created feat/locale-switcher from main',
      detail: null,
      refs: [{ kind: 'branch', label: 'feat/locale-switcher' }],
    }),
    event(2 * DAY + 5 * HOUR, {
      actor: FIXTURE_ACTORS.jordan,
      kind: 'snapshot.restored',
      source: 'event',
      branch: 'feat/pricing-tiers',
      summary: 'restored a snapshot from 4 Sep, 10:02',
      detail: 'Reverted a bad merge of the pricing grid',
      refs: [],
    }),
    event(2 * DAY + 9 * HOUR, {
      actor: FIXTURE_ACTORS.self,
      kind: 'finding.fixed',
      source: 'event',
      branch: 'fix/a11y-contrast',
      projectName: 'clarity-dashboard',
      projectPath: DASHBOARD,
      summary: 'fixed “Muted text fails AA on the panel surface”',
      detail: 'Filed by Accessibility sweep · 3 occurrences',
      refs: [{ kind: 'file', label: 'src/styles/global/tokens-semantic.css' }],
    }),
  ];

  const members: TeamMember[] = [
    {
      actor: FIXTURE_ACTORS.self,
      role: 'admin',
      branch: 'fix/nav-overflow',
      projectName: 'acme-marketing',
      lastPushedAt: at(24 * MINUTE),
      commitsAhead: 2,
      prNumber: null,
      isSelf: true,
    },
    {
      actor: FIXTURE_ACTORS.maya,
      role: 'write',
      branch: 'feat/pricing-tiers',
      projectName: 'acme-marketing',
      lastPushedAt: at(3 * MINUTE),
      commitsAhead: 7,
      prNumber: null,
      isSelf: false,
    },
    {
      actor: FIXTURE_ACTORS.sarah,
      role: 'write',
      branch: 'feat/locale-switcher',
      projectName: 'acme-marketing',
      lastPushedAt: at(1 * HOUR + 20 * MINUTE),
      commitsAhead: 4,
      prNumber: 142,
      isSelf: false,
    },
    {
      actor: FIXTURE_ACTORS.jordan,
      role: 'maintainer',
      branch: 'feat/pricing-tiers',
      projectName: 'acme-marketing',
      lastPushedAt: at(3 * HOUR + 10 * MINUTE),
      commitsAhead: 7,
      prNumber: null,
      isSelf: false,
    },
    {
      actor: FIXTURE_ACTORS.enid,
      role: 'admin',
      branch: 'main',
      projectName: 'acme-marketing',
      lastPushedAt: at(48 * MINUTE),
      commitsAhead: 0,
      prNumber: null,
      isSelf: false,
    },
    // A collaborator with repo access who has pushed nothing. Real, common,
    // and the row that proves the panel reports absence instead of hiding it.
    {
      actor: actor('devon-ok', 'Devon Okafor'),
      role: 'read',
      branch: null,
      projectName: null,
      lastPushedAt: null,
      commitsAhead: 0,
      prNumber: null,
      isSelf: false,
    },
  ];

  const threads: TeamThread[] = [
    {
      id: 'th-1',
      projectName: 'acme-marketing',
      projectPath: MARKETING,
      branch: 'feat/pricing-tiers',
      route: '/pricing',
      target: 'h1 · Simple pricing, no surprises',
      pin: 1,
      resolved: false,
      resolvedBy: null,
      messages: [
        {
          id: 'm-1',
          actor: FIXTURE_ACTORS.jordan,
          at: at(11 * MINUTE),
          body: 'This headline wraps to three lines on a 390px screen and pushes the tier cards below the fold. Can we drop to two lines?',
        },
        {
          id: 'm-2',
          actor: FIXTURE_ACTORS.maya,
          at: at(6 * MINUTE),
          body: "Shortening it to “Simple pricing” fixes it without a breakpoint. I'll take it on my branch.",
        },
      ],
    },
    {
      id: 'th-2',
      projectName: 'acme-marketing',
      projectPath: MARKETING,
      branch: 'feat/pricing-tiers',
      route: '/pricing',
      target: 'section · Compare plans',
      pin: 2,
      resolved: false,
      resolvedBy: null,
      messages: [
        {
          id: 'm-3',
          actor: FIXTURE_ACTORS.sarah,
          at: at(2 * HOUR + 40 * MINUTE),
          body: 'The comparison table scrolls horizontally on tablet but there is no affordance showing it can. Add a fade on the right edge?',
        },
      ],
    },
    {
      id: 'th-3',
      projectName: 'clarity-dashboard',
      projectPath: DASHBOARD,
      branch: 'main',
      route: '/settings/team',
      target: 'button · Invite member',
      pin: 1,
      resolved: false,
      resolvedBy: null,
      messages: [
        {
          id: 'm-4',
          actor: FIXTURE_ACTORS.enid,
          at: at(4 * HOUR),
          body: 'Primary button here competes with Save at the bottom of the same form. One of them should be secondary.',
        },
        {
          id: 'm-5',
          actor: FIXTURE_ACTORS.self,
          at: at(3 * HOUR + 30 * MINUTE),
          body: 'Agreed — Invite is the rarer action. Making it secondary.',
        },
        {
          id: 'm-6',
          actor: FIXTURE_ACTORS.enid,
          at: at(20 * MINUTE),
          body: 'Still reads primary to me on the deployed build. Did that land?',
        },
      ],
    },
    {
      id: 'th-4',
      projectName: 'acme-marketing',
      projectPath: MARKETING,
      branch: 'feat/pricing-tiers',
      route: '/',
      target: 'section · FAQ accordion',
      pin: 3,
      resolved: true,
      resolvedBy: FIXTURE_ACTORS.self,
      messages: [
        {
          id: 'm-7',
          actor: FIXTURE_ACTORS.maya,
          at: at(DAY),
          body: 'The accordion chevrons do not rotate when a panel opens.',
        },
        {
          id: 'm-8',
          actor: FIXTURE_ACTORS.self,
          at: at(5 * HOUR),
          body: 'Fixed — the transform was on the wrong element. Pushed to the branch.',
        },
      ],
    },
  ];

  return {
    events,
    members,
    threads,
    sync: {
      repo: 'acme-studio/acme-marketing',
      lastSyncedAt: at(2 * MINUTE),
      pendingCount: 0,
      error: null,
      syncing: false,
    },
  };
}
