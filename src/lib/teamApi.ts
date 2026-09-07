/**
 * Team — the Tauri boundary.
 *
 * One call, deliberately. `get_team_snapshot` reads git, `gh` and
 * `.shipstudio-team/` and returns the whole shape in `team.ts`; the frontend
 * does no folding, no joining and no status derivation of its own.
 *
 * That is not just tidiness. Every one of those is a *claim about the repo*,
 * and claims about the repo have to be made in one place or two surfaces will
 * eventually disagree about whether a branch is merged. Rust has the repo; the
 * frontend has the pixels.
 *
 * @module lib/teamApi
 */

import { invoke } from '@tauri-apps/api/core';
import type { TeamSnapshot } from './team';

/**
 * Read everything the Team surfaces show for one project.
 *
 * Rejects only when the project is not a git repository. Every other gap — no
 * remote, no `gh`, not signed in, no commits, nobody else on the repo — comes
 * back as a snapshot that honestly contains less, because those are ordinary
 * states rather than failures.
 */
export function getTeamSnapshot(projectPath: string): Promise<TeamSnapshot> {
  return invoke<TeamSnapshot>('get_team_snapshot', { projectPath });
}
