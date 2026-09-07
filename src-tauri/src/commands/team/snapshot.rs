//! `get_team_snapshot` — the one read the whole feature hangs off.
//!
//! Folds the derived half ([`super::derive`], from git and `gh`) together with
//! the authored half ([`super::records`], from `.shipstudio-team/`) into the
//! shape `src/lib/team.ts` already describes.
//!
//! ## The join, and which side wins
//!
//! A stint of commits and a record find each other through the
//! `Ship-Studio-Update` trailer. When they meet:
//!
//! | Field | From |
//! |-------|------|
//! | `headline`, `why`, `changes`, `asks` | the **record** — only the agent knows these |
//! | everything else | **git** — commits, files, branch, PR, status, URL |
//!
//! The record never supplies a fact and git never supplies a sentence. That is
//! not a style preference: it is what makes a fabricated record harmless. An
//! agent that claims it touched forty files produces a row showing the four it
//! actually touched, because the file list was never read from the record.
//!
//! A stint with no record still becomes a row — a thin one, `writtenBy: "app"`,
//! carrying the commit subject verbatim and nothing else. That is the row for
//! the teammate who pushes from the terminal, and it is the reason this works
//! before anyone adopts anything.
//!
//! A record with no commits **also** becomes a row. An agent that wrote its
//! summary before committing, or whose commits have not been fetched yet, is
//! not silently dropped.

use std::collections::{HashMap, HashSet};

use crate::commands::github::parse_github_repo;
use crate::errors::CommandError;
use crate::utils::validate_project_path;

use super::derive::{self, People, PrSummary, Stint};
use super::records::{self, RecordKind, TeamRecord};
use super::{
    TeamActor, TeamMember, TeamSnapshot, TeamSyncStatus, TeamUpdate, TeamUpdateAuthor,
    TeamUpdateStatus,
};

/// How many rows the feed carries. Well past what anyone scrolls; the cap
/// exists so a busy monorepo cannot hand the frontend ten thousand objects.
const MAX_UPDATES: usize = 120;

/// Everything the Team surfaces read, for one project.
///
/// Never fails on an unconfigured repo. No remote, no `gh`, not signed in, no
/// commits — all of them are states the UI already renders honestly, so they
/// come back as a thin snapshot rather than an error dialog. The single
/// exception is a directory that is not a git repository at all, which is worth
/// saying out loud because nothing here can ever work there.
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn get_team_snapshot(project_path: String) -> Result<TeamSnapshot, CommandError> {
    let project = validate_project_path(&project_path)?;
    derive::repo_guard(&project).await?;

    let project_name = project
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_path.clone());
    let project_path_str = project.to_string_lossy().into_owned();

    let repo = repo_slug(&project).await;
    let base = derive::default_base_branch(&project).await;

    // Local first, so a repo with records renders even when the network half
    // times out. Reading files cannot fail in a way worth reporting.
    let stored = records::read_records(&project);
    let adopters = records::logins_with_records(&stored);

    let commits = derive::walk_commits(&project, base.as_deref()).await;
    let stints = derive::group_into_stints(commits);

    let prs = derive::pull_requests(&project).await;
    let people = resolve_people(&project, repo.as_deref()).await;

    let by_id = records::updates_by_id(&stored);
    let mut updates: Vec<TeamUpdate> = Vec::new();
    let mut claimed: HashSet<String> = HashSet::new();
    // What each person is up to, captured here rather than recovered later:
    // this is the one place a row and the git identity behind it are both in
    // hand. Matching them up afterwards means matching on a display name, and
    // display names are not identities.
    let mut doing: HashMap<String, String> = HashMap::new();

    for stint in &stints {
        let record = stint
            .update_id
            .as_ref()
            .and_then(|id| by_id.get(id.as_str()).copied());
        if let Some(record) = record {
            claimed.insert(record.id.clone());
        }
        let update = build_update(
            &project,
            stint,
            record,
            prs.get(&stint.branch),
            repo.as_deref(),
            base.as_deref(),
            &people,
            &project_name,
            &project_path_str,
        )
        .await;

        // Only a row that says something. A thin GitHub-only row would repeat
        // the commit subject already shown beside it, which is noise where a
        // sentence should be.
        if update.written_by != TeamUpdateAuthor::App {
            doing
                .entry(member_key(&update.actor, &stint.author_email))
                .or_insert_with(|| update.headline.clone());
        }
        updates.push(update);
    }

    // Records whose commits are not here — written before the commit, or on a
    // branch this clone has not fetched. Shown with the prose they have and no
    // evidence, which is honest and is still the useful half.
    for record in stored
        .iter()
        .filter(|record| record.kind == RecordKind::Update && !claimed.contains(&record.id))
    {
        updates.push(orphan_update(
            record,
            &people,
            repo.as_deref(),
            &project_name,
            &project_path_str,
        ));
    }

    updates.sort_by(|a, b| b.at.cmp(&a.at));
    updates.truncate(MAX_UPDATES);

    let members = build_members(
        &stints,
        &doing,
        &prs,
        &people,
        &adopters,
        &project_name,
        base.as_deref(),
    );

    Ok(TeamSnapshot {
        threads: records::fold_threads(&stored, &project_name, &project_path_str),
        updates,
        members,
        sync: TeamSyncStatus {
            repo,
            last_synced_at: None,
            pending_count: 0,
            error: None,
            syncing: false,
        },
        seen_ids: Vec::new(),
    })
}

/// `owner/repo` for the project's origin, or `None`.
async fn repo_slug(project: &std::path::Path) -> Option<String> {
    let mut cmd = crate::utils::git_command_in(project).ok()?;
    cmd.args(["remote", "get-url", "origin"]);
    let output = crate::external_command::run_with_timeout(
        tokio::process::Command::from(cmd),
        "git remote get-url".to_string(),
        10,
    )
    .await
    .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_github_repo(String::from_utf8_lossy(&output.stdout).trim())
}

/// Everything GitHub can tell us about who is who on this repo.
///
/// All three lookups degrade to nothing rather than failing: no `gh`, no auth,
/// a repo you can only read. What you lose then is avatars, roles, and the
/// merging of one person's several git emails — never a row, and never a wrong
/// attribution.
async fn resolve_people(project: &std::path::Path, repo: Option<&str>) -> People {
    let me =
        crate::commands::github::get_github_username(Some(project.to_string_lossy().into_owned()))
            .await
            .ok()
            .map(|login| login.to_lowercase());

    let Some(repo) = repo else {
        return People {
            me,
            ..Default::default()
        };
    };

    let (collaborators, mut identities) = tokio::join!(
        derive::collaborators(project, repo),
        derive::identity_map(project, repo)
    );

    // Your own email → your own login, which needs no network and no
    // permissions. Worth doing even when the API answered: it is the identity
    // most likely to be missing from a public repo's recent commits, and you
    // appearing in your own team list twice reads as the feature being broken.
    if let (Some(me), Some(email)) = (me.as_deref(), derive::own_git_email(project).await) {
        identities.entry(email).or_insert_with(|| me.to_string());
    }

    People {
        collaborators,
        identities,
        me,
    }
}

/// One row, from a stint of commits and the record explaining it, if any.
#[allow(clippy::too_many_arguments)]
async fn build_update(
    project: &std::path::Path,
    stint: &Stint,
    record: Option<&TeamRecord>,
    pr: Option<&PrSummary>,
    repo: Option<&str>,
    base: Option<&str>,
    people: &People,
    project_name: &str,
    project_path: &str,
) -> TeamUpdate {
    let tip = stint.tip();

    // The record's actor is preferred when there is one: it carries the GitHub
    // login the writer was actually signed in as, where git only has whatever
    // `user.email` happens to be set to on that machine.
    let actor = match record {
        Some(record) => merge_actor(record.actor(), people),
        None => derive::actor_for(&stint.author_name, &stint.author_email, people),
    };

    TeamUpdate {
        id: record
            .map(|record| record.id.clone())
            .unwrap_or_else(|| format!("commit:{}", tip.sha)),
        at: record.map_or(stint.at, |record| record.at),
        actor,
        written_by: record.map_or(TeamUpdateAuthor::App, TeamRecord::written_by),
        agent_name: record.and_then(|record| record.agent.clone()),

        // The one place prose comes from. With no record, the commit subject
        // stands as written — bad ones included. It is an honest report of a
        // bad commit message, and rewriting it would invent the only thing
        // this row cannot know.
        headline: record
            .and_then(|record| record.headline.clone())
            .unwrap_or_else(|| headline_from_commit(tip)),
        why: record.and_then(|record| record.why.clone()),
        changes: record
            .map(|record| record.changes.clone())
            .unwrap_or_default(),
        asks: record.and_then(|record| record.asks.clone()),

        branch: stint.branch.clone(),
        status: status_for(stint, pr, base),
        project_name: project_name.to_string(),
        project_path: project_path.to_string(),

        commits: stint.evidence(),
        files: derive::files_for(project, stint).await,
        pr_number: pr.map(|pr| pr.number),
        // Deployment truth is per-commit and belongs to the hosting module,
        // which asks a provider. Never inferred here from a red-looking commit.
        build_error: None,
        github_url: derive::github_url_for(repo, pr, &tip.sha),
    }
}

/// A record whose commits this clone does not have.
fn orphan_update(
    record: &TeamRecord,
    people: &People,
    repo: Option<&str>,
    project_name: &str,
    project_path: &str,
) -> TeamUpdate {
    TeamUpdate {
        id: record.id.clone(),
        at: record.at,
        actor: merge_actor(record.actor(), people),
        written_by: record.written_by(),
        agent_name: record.agent.clone(),
        headline: record
            .headline
            .clone()
            .unwrap_or_else(|| "Update".to_string()),
        why: record.why.clone(),
        changes: record.changes.clone(),
        asks: record.asks.clone(),
        branch: record.branch.clone().unwrap_or_default(),
        // No commits reached this clone, so nothing about where the work got to
        // is observable. "In progress" is the only claim available.
        status: TeamUpdateStatus::Working,
        project_name: project_name.to_string(),
        project_path: project_path.to_string(),
        commits: Vec::new(),
        files: Vec::new(),
        pr_number: None,
        build_error: None,
        // Deliberately no commit URL: there is no commit to point at, and a
        // branch URL for a branch that may not exist on the remote is a 404
        // with a confident label on it.
        github_url: match (repo, record.branch.as_deref()) {
            (Some(repo), Some(branch)) if !branch.is_empty() => {
                Some(format!("https://github.com/{repo}/tree/{branch}"))
            }
            _ => None,
        },
    }
}

/// Fill in the avatar GitHub knows about, keeping the record's own identity.
fn merge_actor(actor: TeamActor, people: &People) -> TeamActor {
    let avatar = actor
        .login
        .as_ref()
        .and_then(|login| people.collaborators.get(&login.to_lowercase()))
        .and_then(|(avatar, _)| avatar.clone());
    TeamActor {
        avatar_url: avatar,
        ..actor
    }
}

/// A commit subject as a headline.
///
/// Merge subjects are the one rewrite, because "Merge pull request #139 from
/// acme/fix-plan-type" describes the merge rather than the change, and the part
/// after `from` is a branch name the reader has never seen. The PR number is
/// kept — it is the only part that goes anywhere useful.
fn headline_from_commit(commit: &derive::RawCommit) -> String {
    if commit.is_merge {
        if let Some(rest) = commit.subject.strip_prefix("Merge pull request #") {
            let number: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if !number.is_empty() {
                return format!("Merged pull request #{number}");
            }
        }
    }
    commit.subject.clone()
}

/// Where a stint's work has got to.
///
/// Order matters: a PR's own state is the strongest evidence available, so it
/// is consulted first. Without one, landing on the base branch means merged and
/// anything else means in progress.
fn status_for(stint: &Stint, pr: Option<&PrSummary>, base: Option<&str>) -> TeamUpdateStatus {
    if let Some(pr) = pr {
        return pr.status();
    }
    if base.is_some_and(|base| base == stint.branch) {
        return TeamUpdateStatus::Merged;
    }
    TeamUpdateStatus::Working
}

/// How one person is identified across the snapshot.
///
/// A GitHub login where one is known, the commit email otherwise. Two git
/// identities that resolve to the same login are one person; two that do not
/// are two people. Never the display name — merging on a name is how a
/// namesake's work ends up under your face, and it is not reversible once the
/// feed has shown it.
fn member_key(actor: &TeamActor, email: &str) -> String {
    actor
        .login
        .as_deref()
        .map(str::to_lowercase)
        .unwrap_or_else(|| email.to_lowercase())
}

/// Who is on this project, and what they are demonstrably doing.
#[allow(clippy::too_many_arguments)]
fn build_members(
    stints: &[Stint],
    doing: &HashMap<String, String>,
    prs: &HashMap<String, PrSummary>,
    people: &People,
    adopters: &HashSet<String>,
    project_name: &str,
    base: Option<&str>,
) -> Vec<TeamMember> {
    let mut order: Vec<String> = Vec::new();
    let mut members: HashMap<String, TeamMember> = HashMap::new();

    for stint in stints {
        let actor = derive::actor_for(&stint.author_name, &stint.author_email, people);
        let key = member_key(&actor, &stint.author_email);

        let entry = members.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            let login = actor.login.as_deref().map(str::to_lowercase);
            TeamMember {
                role: login
                    .as_ref()
                    .and_then(|login| people.collaborators.get(login))
                    .and_then(|(_, role)| *role),
                uses_ship_studio: login.as_ref().is_some_and(|login| adopters.contains(login)),
                is_self: match (login.as_deref(), people.me.as_deref()) {
                    (Some(login), Some(me)) => login == me,
                    _ => false,
                },
                doing: doing.get(&key).cloned(),
                actor,
                branch: None,
                project_name: Some(project_name.to_string()),
                last_pushed_at: None,
                commits_ahead: 0,
                pr_number: None,
            }
        });

        // Stints arrive newest-first, so the first one seen for a person is
        // their most recent — that is the branch and time worth showing.
        if entry.last_pushed_at.is_none() {
            entry.last_pushed_at = Some(stint.at);
            entry.branch = Some(stint.branch.clone());
            entry.pr_number = prs.get(&stint.branch).map(|pr| pr.number);
        }
        // "Ahead" is work not yet on the base branch. Commits already on it are
        // not ahead of anything, so they do not count.
        if base.is_some_and(|base| base != stint.branch) {
            entry.commits_ahead += stint.commits.len() as u32;
        }
    }

    let mut list: Vec<TeamMember> = order
        .into_iter()
        .filter_map(|key| members.remove(&key))
        .collect();
    list.sort_by(|a, b| {
        b.is_self
            .cmp(&a.is_self)
            .then(b.last_pushed_at.cmp(&a.last_pushed_at))
    });
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::team::derive::RawCommit;

    fn commit(subject: &str, merge: bool) -> RawCommit {
        RawCommit {
            sha: "abcdef1234".to_string(),
            short_sha: "abcdef1".to_string(),
            subject: subject.to_string(),
            at: 1_000_000,
            author_name: "Theo Vance".to_string(),
            author_email: "theo@x.com".to_string(),
            branch: "main".to_string(),
            update_id: None,
            is_merge: merge,
        }
    }

    fn stint(branch: &str, commits: Vec<RawCommit>) -> Stint {
        Stint {
            at: commits[0].at,
            author_name: commits[0].author_name.clone(),
            author_email: commits[0].author_email.clone(),
            update_id: commits.iter().find_map(|c| c.update_id.clone()),
            branch: branch.to_string(),
            commits,
        }
    }

    fn open_pr(number: i64) -> PrSummary {
        PrSummary {
            number,
            state: "OPEN".to_string(),
            url: String::new(),
            review_requested: false,
            has_reviews: false,
        }
    }

    #[test]
    fn keeps_an_ordinary_commit_subject_exactly_as_written() {
        assert_eq!(headline_from_commit(&commit("wip", false)), "wip");
    }

    #[test]
    fn rewrites_only_the_merge_subject_and_keeps_the_pr_number() {
        assert_eq!(
            headline_from_commit(&commit(
                "Merge pull request #139 from acme/fix-plan-type",
                true
            )),
            "Merged pull request #139"
        );
    }

    #[test]
    fn leaves_a_hand_written_merge_subject_alone() {
        assert_eq!(
            headline_from_commit(&commit("Merge Martin's breadcrumb work", true)),
            "Merge Martin's breadcrumb work"
        );
    }

    #[test]
    fn work_on_the_base_branch_reads_as_merged() {
        let s = stint("main", vec![commit("x", false)]);
        assert_eq!(status_for(&s, None, Some("main")), TeamUpdateStatus::Merged);
    }

    #[test]
    fn work_on_a_topic_branch_with_no_pr_is_in_progress() {
        let s = stint("feat/pricing", vec![commit("x", false)]);
        assert_eq!(
            status_for(&s, None, Some("main")),
            TeamUpdateStatus::Working
        );
    }

    #[test]
    fn a_pr_outranks_the_branch_it_is_on() {
        let s = stint("main", vec![commit("x", false)]);
        assert_eq!(
            status_for(&s, Some(&open_pr(7)), Some("main")),
            TeamUpdateStatus::NeedsReview
        );
    }

    /// `build_members` with everything GitHub would have supplied left empty —
    /// the shape of a repo with no remote, or no `gh`, or no auth.
    fn members_of(stints: &[Stint], doing: &HashMap<String, String>) -> Vec<TeamMember> {
        build_members(
            stints,
            doing,
            &HashMap::new(),
            &People::default(),
            &HashSet::new(),
            "site",
            Some("main"),
        )
    }

    #[test]
    fn counts_ahead_only_for_work_that_has_not_landed() {
        let stints = vec![
            stint("feat/pricing", vec![commit("a", false), commit("b", false)]),
            stint("main", vec![commit("c", false)]),
        ];
        let members = members_of(&stints, &HashMap::new());
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].commits_ahead, 2);
        // Their newest stint is the one shown.
        assert_eq!(members[0].branch.as_deref(), Some("feat/pricing"));
    }

    #[test]
    fn a_member_with_no_github_login_gets_no_role_rather_than_a_plausible_one() {
        let stints = vec![stint("feat/x", vec![commit("a", false)])];
        let members = members_of(&stints, &HashMap::new());
        assert_eq!(members[0].role, None);
        assert!(!members[0].uses_ship_studio);
    }

    #[test]
    fn identifies_a_person_by_login_or_email_but_never_by_display_name() {
        let known = TeamActor {
            login: Some("MayaReed".to_string()),
            name: "Maya Reed".to_string(),
            avatar_url: None,
        };
        assert_eq!(member_key(&known, "maya@x.com"), "mayareed");

        let anonymous = TeamActor {
            login: None,
            name: "Maya Reed".to_string(),
            avatar_url: None,
        };
        assert_eq!(member_key(&anonymous, "Maya@X.com"), "maya@x.com");
    }

    #[test]
    fn uses_ship_studio_follows_the_records_not_a_declaration() {
        let mut noreply = commit("a", false);
        noreply.author_email = "9+theo@users.noreply.github.com".to_string();
        let stints = vec![stint("feat/x", vec![noreply])];
        let adopters: HashSet<String> = ["theo".to_string()].into_iter().collect();
        let people = People {
            me: Some("theo".to_string()),
            ..Default::default()
        };
        let members = build_members(
            &stints,
            &HashMap::new(),
            &HashMap::new(),
            &people,
            &adopters,
            "site",
            Some("main"),
        );
        assert!(members[0].uses_ship_studio);
        assert!(members[0].is_self);
    }

    #[test]
    fn doing_reaches_the_member_it_belongs_to() {
        let stints = vec![stint("feat/x", vec![commit("a", false)])];
        // Keyed the way the caller keys it: no login on this commit, so the
        // email is the identity.
        let doing = HashMap::from([(
            "theo@x.com".to_string(),
            "Rebuilt the pricing tiers as a grid".to_string(),
        )]);
        let members = members_of(&stints, &doing);
        assert_eq!(
            members[0].doing.as_deref(),
            Some("Rebuilt the pricing tiers as a grid")
        );
    }

    #[test]
    fn a_person_with_only_bare_commits_is_doing_nothing_we_can_name() {
        let stints = vec![stint("feat/x", vec![commit("wip", false)])];
        assert_eq!(members_of(&stints, &HashMap::new())[0].doing, None);
    }
}
