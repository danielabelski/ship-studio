//! # Team (multiplayer)
//!
//! Multiplayer with no server, no database and no accounts. A team's shared
//! state is files in their own git repository, and the network is `git fetch` /
//! `git push`. `docs/team-multiplayer.md` is the design; this module is the
//! half of it that runs.
//!
//! ## Two halves, and only one of them needs anybody to adopt anything
//!
//! | Half | Source | Needs |
//! |------|--------|-------|
//! | **Derived** ([`derive`]) | `git log`, `gh pr list` | nothing — works on any repo, today |
//! | **Authored** ([`records`]) | `.shipstudio-team/updates/**` | someone using Ship Studio |
//!
//! [`snapshot`] folds the two together. The derived half is the floor: a
//! teammate pushing from the terminal, from Cursor, from a CI bot or from
//! GitHub's web editor still shows up, because their commits are in the repo
//! whatever wrote them. The authored half is the ceiling: when a record exists
//! for a piece of work, it replaces the bare commit subject with a sentence
//! that says *why*.
//!
//! **Derived rows are never dressed up.** A commit with no record produces a
//! `writtenBy: "app"` row saying only what git can prove, and the UI draws it as
//! the lesser thing it is. Guessing a `why` back out of a diff is exactly the
//! mistake `generate_commit_message_for_path` already makes.
//!
//! ## The join key
//!
//! A record and its commits find each other through a git trailer:
//!
//! ```text
//! Ship-Studio-Update: 01K4J8Q20001ABCDEFGHJKMNPQ
//! ```
//!
//! That is why the record on disk holds prose and nothing factual. Commits,
//! files, line counts and PR numbers are recomputed from git on every read, so
//! a record physically cannot carry evidence that disagrees with the repo —
//! "Never Assume Data" applied to the agent as a source.
//!
//! It also means the trail outlives the app: someone who never fetches
//! `.shipstudio-team/` still gets the feed's factual skeleton from `git log`.
//!
//! ## Reading is lenient, writing is strict
//!
//! These files arrive over git from other people's machines running other
//! people's versions. So on the way **in**, an unknown field is ignored and an
//! unknown record kind is skipped — one teammate upgrading must never blank the
//! feed for everyone who hasn't. On the way **out** the same shape is
//! `deny_unknown_fields` with hard caps, because that is the moment an agent
//! could put something in the repo permanently.

mod derive;
mod push;
pub(crate) mod records;
mod snapshot;
mod summarise;
mod trailers;
pub(crate) mod writer;

pub use push::{prepare as prepare_push, sharing_enabled, PushContent};
pub use snapshot::*;
pub use summarise::summarise_working_tree;
pub use trailers::*;
pub use writer::TeamSummary;

use serde::{Deserialize, Serialize};

/// Where this project's team data lives.
///
/// Not under `.shipstudio/` — `ensure_gitignore_has_shipstudio` gitignores that
/// whole directory, so anything written there would never be committed and no
/// teammate would ever see it.
pub const TEAM_DIR: &str = ".shipstudio-team";

/// The trailer that links a commit to the record explaining it.
pub const UPDATE_TRAILER: &str = "Ship-Studio-Update";

/// Who did the thing. Resolved from git and GitHub — never typed by a user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamActor {
    /// GitHub login. The only globally unique handle available without a
    /// server, and the join key against repo collaborators.
    pub login: Option<String>,
    pub name: String,
    /// From the GitHub API only. `None` renders initials, never a guessed
    /// gravatar URL.
    pub avatar_url: Option<String>,
}

/// Which of the three writers produced a row. Drives how much it may claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamUpdateAuthor {
    /// The agent that did the work, through a schema-checked tool.
    Agent,
    /// Someone typed it.
    Person,
    /// Ship Studio saw a commit with no record attached and said only that.
    App,
}

/// Where a piece of work has got to.
///
/// Every variant is *observable*: a branch exists, a PR is open, a deployment
/// matched the SHA. Nothing here is self-declared progress, which is why an
/// agent is not allowed to write this field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TeamUpdateStatus {
    Working,
    NeedsReview,
    InReview,
    Merged,
    Deployed,
    Broken,
}

/// A file the update touched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamFileTouch {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

/// A commit backing an update. Evidence, not content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamCommit {
    pub sha: String,
    pub message: String,
}

/// One thing someone did — the unit the whole feature is built on.
///
/// Mirrors `TeamUpdate` in `src/lib/team.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamUpdate {
    /// The record's ULID, or `commit:<sha>` for a derived row.
    pub id: String,
    /// Unix **milliseconds**, from the author's clock. There is no server clock
    /// to correct against; the UI shows relative times grouped by day, which
    /// keeps clock skew below the resolution anyone reads.
    pub at: i64,
    pub actor: TeamActor,
    pub written_by: TeamUpdateAuthor,
    pub agent_name: Option<String>,

    pub headline: String,
    pub why: Option<String>,
    pub changes: Vec<String>,
    pub asks: Option<String>,

    pub branch: String,
    pub status: TeamUpdateStatus,
    pub project_name: String,
    pub project_path: String,

    pub commits: Vec<TeamCommit>,
    pub files: Vec<TeamFileTouch>,
    pub pr_number: Option<i64>,
    pub build_error: Option<String>,
    pub github_url: Option<String>,
}

/// Repo role, from the GitHub collaborators API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeamRole {
    Admin,
    Maintainer,
    Write,
    Read,
}

/// A teammate and what they are demonstrably working on.
///
/// Deliberately not presence. Nobody is "online" — there is no server to say
/// so. What a remote genuinely knows is that this person has a branch, it moved
/// at this time, and it is this far ahead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub actor: TeamActor,
    /// `None` when the collaborators API is unavailable — the common case with
    /// read-only access. The UI omits the label rather than inventing a
    /// plausible role.
    pub role: Option<TeamRole>,
    pub branch: Option<String>,
    pub project_name: Option<String>,
    pub last_pushed_at: Option<i64>,
    pub commits_ahead: u32,
    pub pr_number: Option<i64>,
    /// One line on what they are up to, from their most recent update.
    pub doing: Option<String>,
    /// Derived, never declared: true when any record under `.shipstudio-team/`
    /// carries their login. Nobody registers and nobody is asked to.
    pub uses_ship_studio: bool,
    pub is_self: bool,
}

/// A comment thread, folded from its comment records.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamThread {
    pub id: String,
    pub project_name: String,
    pub project_path: String,
    pub branch: String,
    pub route: String,
    pub target: String,
    pub pin: u32,
    pub resolved: bool,
    pub resolved_by: Option<TeamActor>,
    pub messages: Vec<TeamMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMessage {
    pub id: String,
    pub actor: TeamActor,
    pub at: i64,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<bool>,
}

/// How this project's team data is reaching everyone else.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSyncStatus {
    /// `owner/repo`, or `None` when the project has no GitHub remote. Not an
    /// error state — a project with no remote is simply single-player.
    pub repo: Option<String>,
    pub last_synced_at: Option<i64>,
    pub pending_count: u32,
    /// Last sync failure, verbatim. Shown, never swallowed.
    pub error: Option<String>,
    pub syncing: bool,
}

/// Everything the Team surfaces read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSnapshot {
    pub updates: Vec<TeamUpdate>,
    pub members: Vec<TeamMember>,
    pub threads: Vec<TeamThread>,
    pub sync: TeamSyncStatus,
    pub seen_ids: Vec<String>,
}
