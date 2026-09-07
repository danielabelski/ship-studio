# Team (multiplayer)

**Status: vision prototype.** Every screen described here is built and can be
used. None of it reaches a backend — the data comes from `src/lib/teamFixtures.ts`.
This document is the design the UI was built against, and the plan for making
it real.

Building is a multiplayer game, but Ship Studio is free, open source, and has
no server, no accounts and no database. So this feature is built on the two
things a team already has: **their repository, and the coding agents they are
already paying for.**

## What makes it Ship Studio's version

| Problem a multiplayer backend normally solves | Solved here by |
| --- | --- |
| Identity | the GitHub login behind the push (`gh api user`) |
| Authorization | repo access — no push right, no write |
| Durability | it is a git repo, replicated on every clone |
| Ordering | ULID ids plus git history |
| Review | pull requests |
| Offline | native; a clone is a full replica |

Nobody is invited to anything. The people who can see your team activity are
the people who can already see the repository, which is a permission model the
team has already agreed on and already maintains.

## 1. The unit is what someone did, not what git recorded

The first version of this modelled git events — pushed, merged, branched — and
it was useless. "Maya pushed 3 commits" is a git log with faces on it; nobody
opens it twice. Commit messages are written for the person who wrote them, an
hour later, and they never say *why*.

So the unit is a `TeamUpdate` (`src/lib/team.ts`): one sentence about what
changed, why it changed, and what it needs from you. Commits and files hang off
it as evidence you can expand — receipts for a claim, not the claim itself.

```ts
{ headline, why, changes[], asks }        // written by the agent
{ actor, at, branch, status, commits[],   // computed by Ship Studio from git
  files[], prNumber, buildError, githubUrl }
```

That split is load-bearing. **The agent writes four prose fields and nothing
else.** Everything factual is computed from git and `gh`, so a record cannot
carry fabricated evidence — "Never Assume Data" applied to the agent as a
source.

This is also what an agent is *for*. It just did the work, it has the session
in context, and it can say "the flex version could not hold three columns at
1024 without wrapping, so I moved it to grid" — which no diff will ever tell
you. Ship Studio can observe that a push happened. Only the agent can say what
it meant.

## 2. Append-only, one file per record

The decision the feature lives or dies on. Every record is written **once**, to
its own file named by its own id, and never modified:

```
.shipstudio-team/updates/2026-09-07/01K4J8Q2-mayareed.json
```

Two people writing in the same second produce two different files, so git
merges them with no conflict — by construction, not by luck. Put the same data
in one `activity.json` and every concurrent write is a merge conflict in a JSON
blob, which is the failure that ends the feature in week one.

Mutation is therefore also an append: resolving a comment writes a new record
rather than editing the old one, and current state is a fold over the records
computed at read time.

**Note the path.** `ensure_gitignore_has_shipstudio`
(`src-tauri/src/commands/projects/mod.rs`) gitignores the whole `.shipstudio/`
directory, so team data cannot live there. (That also means workflow
definitions are not committed today, despite `docs/workflows-inbox.md` saying
they are source to be reviewed in a PR — worth fixing separately.)

## 3. Three writers, ranked by how much they can be relied on

| | Writer | Reliability | Covers |
| --- | --- | --- | --- |
| 1 | Ship Studio (Rust) | deterministic | pushes, branches, PRs, deploys, workflow runs, comments |
| 2 | The agent, via a schema-checked tool | agent may decline | what changed and why |
| 3 | Any agent, via a committed skill | best effort | the same, outside the app |

**Layer 1 backfills for 2 and 3, never the reverse.** If no agent writes a
summary, Ship Studio still records the push from what changed on disk — you
lose the explanation, not the entry. If every agent on the team ignored the
skill forever, the feed still works; it just reads like a git log.

That is the same standard agent-led onboarding already holds: *the agent
drives, the app verifies.*

The `app`-written rows are drawn as the lesser thing they are, and say so:
*"Straight from GitHub. Enid isn't pushing through Ship Studio, so there is no
record of why this changed — only that it did."* Every row carries **Open in
GitHub**, not just those — GitHub is the one surface the whole team can see
whether or not they use this app.

### How everyone's agent gets the protocol

The skill is distributed by git too. Ship Studio writes it into the repo and
commits it:

```
.claude/skills/shipstudio-team/SKILL.md    ← Claude Code
AGENTS.md  (one section)                    ← Codex
```

Clone the repo and your agent has the protocol. Inside the app it is better
than a file convention: `src-tauri/src/agent_bridge.rs` already runs a loopback
MCP server and registers it with the agent CLI, so the agent gets a *schema*
rather than a markdown format it can get subtly wrong.

## 4. Privacy: enforced, not requested

Everything here is committed history. Unpublishing means rewriting published
history, so a leak is effectively permanent. There is no server, so there is no
scrubber and no revocation. The human is the last filter, not the first.

**Publication is the push, not the write.** Records are local until the user
pushes, so the review point is a surface that already exists.

### What is mechanically enforced

In Rust, before the file is written and before anything is committed:

1. `#[serde(deny_unknown_fields)]` — an agent cannot invent a `transcript` field
2. Field allowlist: the agent writes `headline`, `why`, `changes[]`, `asks`
3. Caps (headline ≤ 120, why ≤ 600, ≤ 8 changes ≤ 200, asks ≤ 300).
   **Over-length is a rejection, not a truncation** — truncating mid-sentence
   publishes half a leak
4. Shape rejection: code fences, `>` quote lines, `+`/`-` diff prefixes, more
   than two newlines. The mechanical proxy for "don't paste the session"
5. Absolute paths rewritten repo-relative (reuse `scrub_string` in
   `src-tauri/src/logging.rs`)
6. Secret scan against the project's own `.env*` values plus known key prefixes
   → **hard reject, and say rotate it**. Never silently redact: that turns a
   rotate-your-key incident into a thing nobody knew happened
7. PII and non-public-host scans → hold for review
8. The commit is created with a pathspec limited to `.shipstudio-team/`, so a
   record can never sweep up unrelated staged work

### What is best-effort

The skill's prompt: don't quote the user, don't name people outside the repo,
don't characterise a teammate's work, write about the code not the session.
These help and they are not guarantees.

**The honest line: shape, length and known-dangerous strings can be enforced.
Meaning cannot.** There is no mechanical answer for "the user said something
unkind about a colleague" — that limit is stated in the UI rather than papered
over with a detector nobody trusts.

### Defaults

| | Default |
| --- | --- |
| Conversation, prompts, agent reasoning, tool calls | **out — no field, no setting** |
| Terminal output, dev-server logs, stack traces | out |
| Diff content, code excerpts | out (already in git) |
| Screenshots | out — no scanner reads pixels |
| Machine info, IP, location, timings, token spend | out |
| `why` + `changes` in the PR body | **on for private repos, off for public** |
| Review | `before-push` |

Public and private repos are different audiences: a PR description on a public
repo is world-visible forever, including in forks.

### Settings

`team.sharing` (`off`/`records`/`records+pr`), `team.review`
(`auto`/`before-push`/`every`), `team.redactions`, `team.agent_authoring`.

**`team.redactions` lives in `~/ShipStudio/.shipstudio/`, never in the repo** —
a committed redaction list publishes the client name it exists to hide.

### Refused outright

No conversation or transcript field at any setting. No terminal output. No
screenshots. No presence or effort telemetry. No aggregate summaries about
people — commit data plus an LLM makes "who is slowest" trivial, and in a repo
everyone can read. And no "delete this record" button implying unpublishing: it
cannot remove the file from anyone's clone.

## 5. The git trail

Today Ship Studio's history reads `Update from Ship Studio` (`ai.rs`,
`github.rs`) or one agent-written subject line derived **from the diff, after
the session is over** — reading the same diff a stranger would, guessing at
intent, because by then nothing remembers why.

The record fixes this, because the commit message and the team update are the
same content written once:

```
TeamUpdate → commit subject + body
           → PR title + description
           → merge commit body
           → the feed card
```

```
Rebuild the pricing tiers as a CSS grid

The flex row could not hold three columns at 1024px without the third
wrapping under the first two, and the fix people kept reaching for was a
hardcoded width that broke again at every new tier.

- Replace the flex row with a 3-up grid that collapses to 1-up under 768px
- Remove the four hardcoded card widths this was working around

Co-Authored-By: Claude <noreply@anthropic.com>
Made-With: Claude Code in Ship Studio
Ship-Studio-Update: 01K4J8Q20001
```

- `Ship-Studio-Update` is the **join key**: it links the commit to its record,
  so the feed can be rebuilt from `git log` alone if `.shipstudio-team/` was
  never fetched. The trail survives the app.
- Attribution is a **trailer, never the subject** — machine-readable, stays out
  of `git log --oneline`. On by default, one setting to turn off.
- **Match the repo's existing style.** If the last 50 commits are `feat:` /
  `fix:`, write that. Read it from history rather than imposing a convention.
- **Never commit words on someone's behalf without showing them.** The push
  flow shows the message before it writes it, editable.

## 6. What is built, and what is next

**Built (UI, on fixtures):**

- `src/lib/team.ts` — the model. `teamFixtures.ts`, `teamStore.ts` — data and store
- `src/components/team/` — update card, updates feed, people, threads,
  coverage/invite, how-it-works, presence, floating panel
- Home-level Team screen (`TeamView`) beside Workflows and Inbox
- In-workspace presence in the header + floating panel, adopting the open project
- `src/hooks/useTeamWorkspace.tsx` — the one integration point
- `src/commands/useTeamCommands.tsx` — palette entries
- `src/styles/features/team/` — five sheets
- `src/harness/scenarios/team.ts` — seven scenarios

**Not built:** anything below the store. No Rust, no files on disk, no git.

**The order I would build it in:**

1. `.shipstudio-team/` reader + fold → `get_team_snapshot`. Read-only first, so
   the feed shows real data before anything writes.
2. The GitHub-derived half — commits, branches, PRs via `gh`. This is what makes
   it useful on day one with zero adopters, and it needs no writer.
3. The redaction gauntlet (§4), with tests, **before** the first writer exists.
4. `append_team_record` + the debounced commit, writing via a separate index
   (`GIT_INDEX_FILE` + `commit-tree` + `update-ref`) so a background write never
   touches the user's working tree or index.
5. The MCP tool on the existing agent bridge.
6. The committed skill.
7. The commit/PR message path (§5) and its preview surface.

Steps 1–2 give a working, useful feature with no agent involvement at all.
Everything after that is enrichment.
