//! What a push writes, beyond the code.
//!
//! One agent call, three places the answer lands:
//!
//! ```text
//! summarise the working tree
//!   -> the commit message      (subject + why + changes)
//!   -> .shipstudio-team/…json  (the record the feed reads)
//!   -> Ship-Studio-Update:     (the trailer joining the two)
//! ```
//!
//! All in a **single commit**, which is the decision this module exists to
//! make. The record and the work it describes go in together, so there is no
//! window where one exists without the other: no record about a commit that was
//! never pushed, no commit whose explanation is sitting uncommitted on someone's
//! laptop. Two commits could not promise that.
//!
//! ## Everything here is optional, and the push never waits on it
//!
//! No agent, no headless mode, a timeout, an unparseable reply, a summary the
//! gauntlet refuses: every one of them falls back to a plain commit and pushes.
//! A team feature that can stop you shipping is a team feature people turn off.

use crate::errors::CommandError;

use super::writer::{self, TeamSummary};

/// What a push should commit, once the agent has had its say.
pub struct PushContent {
    /// The full commit message, trailers not yet applied.
    pub message: String,
    /// The record's id, when one was written. Becomes the commit trailer.
    pub update_id: Option<String>,
    /// The agent that wrote it, for the `Made-With` trailer.
    pub agent: Option<&'static str>,
}

/// Whether pushes write team records.
///
/// On by default: a feed nobody writes to is the GitHub half forever, which is
/// the state this whole feature exists to improve on. It is disclosed in
/// Settings next to what it writes, and turning it off costs one click.
pub fn sharing_enabled() -> bool {
    crate::commands::setup::read_app_state()
        .team_sharing_enabled
        .unwrap_or(true)
}

/// Prepare a push: summarise, write the record, and build the commit message.
///
/// `provided` is a message the user typed. It wins outright and no agent is
/// asked — a person who wrote their own commit message has said what they
/// wanted said, and paraphrasing it back at them is the opposite of helpful.
pub async fn prepare(
    project: &std::path::Path,
    branch: &str,
    provided: Option<String>,
) -> PushContent {
    if let Some(message) = provided
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
    {
        return PushContent {
            message,
            update_id: None,
            agent: None,
        };
    }

    if !sharing_enabled() {
        // Still worth the agent's subject line; just nothing written to the
        // repo beyond the commit itself.
        return plain(project).await;
    }

    let (summary, agent) = match super::summarise_working_tree(project).await {
        Ok(result) => result,
        Err(error) => {
            tracing::debug!(%error, "no team summary for this push; falling back");
            return plain(project).await;
        }
    };

    let message = writer::commit_message(&summary);
    match write(project, &summary, branch, agent).await {
        Ok(id) => PushContent {
            message,
            update_id: Some(id),
            agent: Some(agent),
        },
        Err(error) => {
            // The gauntlet refused. The *commit message* is still the agent's
            // summary, because it went through the same checks — what is lost
            // is the structured record, not the explanation.
            tracing::warn!(%error, "team record rejected; committing without one");
            PushContent {
                message,
                update_id: None,
                agent: Some(agent),
            }
        }
    }
}

/// A summary with nothing written to `.shipstudio-team/`.
async fn plain(project: &std::path::Path) -> PushContent {
    match super::summarise_working_tree(project).await {
        Ok((summary, agent)) => PushContent {
            message: writer::commit_message(&summary),
            update_id: None,
            agent: Some(agent),
        },
        Err(_) => PushContent {
            message: crate::commands::ai::DEFAULT_COMMIT_MESSAGE.to_string(),
            update_id: None,
            agent: None,
        },
    }
}

/// Run the gauntlet and write the file.
async fn write(
    project: &std::path::Path,
    summary: &TeamSummary,
    branch: &str,
    agent: &str,
) -> Result<String, CommandError> {
    // Who is pushing. The GitHub login is preferred because it is the only
    // handle that means the same thing on everyone else's machine; the git name
    // is the fallback so a record is never anonymous.
    let login =
        crate::commands::github::get_github_username(Some(project.to_string_lossy().into_owned()))
            .await
            .ok();
    let name = git_config(project, "user.name")
        .await
        .or_else(|| login.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    writer::write_record(
        project,
        summary,
        branch,
        login.as_deref(),
        &name,
        Some(agent),
    )
}

async fn git_config(project: &std::path::Path, key: &str) -> Option<String> {
    let mut cmd = crate::utils::git_command_in(project).ok()?;
    cmd.args(["config", key]);
    let output = crate::external_command::run_with_timeout(
        tokio::process::Command::from(cmd),
        format!("git config {key}"),
        10,
    )
    .await
    .ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_message_the_user_typed_is_used_verbatim_and_asks_no_agent() {
        let dir = std::env::temp_dir().join(format!("ss-push-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);

        let content = prepare(&dir, "main", Some("  Fix the nav  ".to_string())).await;
        assert_eq!(content.message, "Fix the nav");
        // No record, and no attribution: a person wrote this, not an agent.
        assert_eq!(content.update_id, None);
        assert_eq!(content.agent, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn falls_back_rather_than_failing_when_there_is_nothing_to_summarise() {
        // Not a git repo, so every path through the summariser errors. A push
        // must still get a message.
        let dir = std::env::temp_dir().join(format!("ss-push-empty-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);

        let content = prepare(&dir, "main", None).await;
        assert!(!content.message.is_empty());
        assert_eq!(content.update_id, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
