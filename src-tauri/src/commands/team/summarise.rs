//! Asking the agent what it just did.
//!
//! The one call that makes the feature worth having. It replaces
//! `generate_commit_message_for_path`, which asked for a single subject line
//! and got what it asked for: "Update the pricing table". A subject line is
//! what a diff already tells you. What a diff never tells you is *why*, and by
//! the time anyone wants to know, nothing remembers.
//!
//! ## Why this is the same call as the commit message
//!
//! Because they are the same content. A good commit message and a good team
//! update answer the same three questions, so asking twice would cost two agent
//! invocations to produce two summaries that can disagree with each other. One
//! call, one answer, written into the commit *and* the record ([`super::writer`]).
//!
//! ## What the prompt is allowed to promise
//!
//! Nothing. Every rule below is also enforced in Rust, because a prompt is a
//! request and this text lands in permanent history. The prompt exists to make
//! the *usual* case good; [`super::writer::gauntlet`] exists to make the bad
//! case impossible. Where they overlap that is deliberate: a model that follows
//! the prompt never meets the gauntlet, and a model that ignores it never
//! reaches the repo.

use crate::agent::get_active_agent;
use crate::errors::CommandError;

use super::writer::TeamSummary;

/// Longer than the commit-message budget was, because this asks for more
/// thinking. Still short enough that a push does not feel like a build.
const SUMMARY_TIMEOUT_SECS: u64 = 45;

/// What the agent is asked for.
///
/// The privacy rules are stated as *rules about the reader*, not as warnings.
/// "Everyone who can see the repository will read this, forever" is a fact a
/// model can reason from; "do not leak secrets" is a rule it can satisfy while
/// still pasting a session.
pub fn build_prompt(status: &str, diff: &str) -> String {
    format!(
        r###"Summarise these uncommitted changes for the rest of the team.

## Files changed (git status --porcelain)
{status}

## Diff (git diff HEAD)
{diff}

Reply with ONE JSON object and nothing else. No prose before it, no code fence
around it.

{{
  "headline": "One line, imperative mood, under 72 characters. What changed.",
  "why": "Two or three sentences on WHY. What was broken, what forced this
          approach, what the obvious alternative was and why it failed.",
  "changes": ["What specifically changed, as a person would list them. Max 8."],
  "asks": "What this needs from whoever reads it, if anything. Usually null."
}}

**`why` is the field that matters.** Everything else is recoverable from the
diff by anyone who cares to look; `why` is not recoverable by anyone, ever,
once you have finished this reply. A record with a headline and no `why` is a
commit subject with extra steps.

`why` and `changes` are different questions and must not be swapped. "Switched
the container to grid" is a change. "The flex row relied on a hardcoded 320px
card width, so three cards needed 992px and the third wrapped below 1024" is
why. If you find yourself explaining the reason inside `changes`, it belongs in
`why` instead.

Set `why` to null only when the change genuinely has no reason worth stating —
a typo fix, a version bump, a rename. Never invent one to fill the field.

This text is committed to the repository. Everyone with access reads it, it
cannot be edited afterwards, and it will still be there in ten years. So:

- Write about the code. Never about the conversation that produced it, what the
  user asked for, what you tried and abandoned, or how the session went.
- Never quote the user. Never include a prompt, a tool call, or terminal output.
- Never name a person who is not in this repository's history.
- Never characterise a teammate's work or a teammate's decisions.
- No file paths outside the project. No credentials, tokens or .env values, in
  any field, even to say one was changed — name the *setting*, never the value.
"###
    )
}

/// Pull the JSON object out of whatever the agent replied with.
///
/// Models wrap JSON in prose and fences however firmly they are asked not to,
/// so the parse looks for the outermost balanced object rather than trusting
/// the reply to be clean. Failing here is fine: the caller falls back to a
/// plain commit message and the push proceeds.
pub fn parse_summary(response: &str) -> Result<TeamSummary, String> {
    let start = response
        .find('{')
        .ok_or("no JSON object in the agent's reply")?;

    // Balanced-brace scan, skipping braces inside strings so a `why` mentioning
    // `{` does not truncate the object.
    let bytes = response.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut end = None;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            match b {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end.ok_or("the agent's JSON object was never closed")?;

    // `deny_unknown_fields` does its job here: an agent that added a field is
    // refused at the boundary rather than having it silently dropped.
    serde_json::from_str::<TeamSummary>(&response[start..end])
        .map_err(|e| format!("could not read the agent's summary: {e}"))
}

/// Ask the active agent to summarise the working tree.
///
/// Returns the summary and the agent's display name. Errors are ordinary: no
/// headless mode, no CLI installed, nothing to summarise, a timeout. Every
/// caller falls back to a plain commit message, because a push must never fail
/// because a summary could not be written.
pub async fn summarise_working_tree(
    path: &std::path::Path,
) -> Result<(TeamSummary, &'static str), CommandError> {
    let agent = get_active_agent();
    let response =
        crate::commands::ai::run_working_tree_prompt(path, build_prompt, SUMMARY_TIMEOUT_SECS)
            .await?;

    // A reply we cannot read is an ordinary miss, not a malfunction: the caller
    // falls back to a plain commit message and the push carries on.
    let summary = parse_summary(&response).map_err(CommandError::expected)?;
    Ok((summary, agent.display_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_clean_reply() {
        let summary = parse_summary(
            r#"{"headline":"Rebuild the pricing tiers","why":"The flex row broke at 1024px.","changes":["Grid"],"asks":null}"#,
        )
        .expect("parses");
        assert_eq!(summary.headline, "Rebuild the pricing tiers");
        assert_eq!(summary.changes, ["Grid"]);
        assert_eq!(summary.asks, None);
    }

    #[test]
    fn digs_the_object_out_of_the_prose_models_wrap_it_in() {
        let summary = parse_summary(
            "Here's the summary:\n\n```json\n{\"headline\":\"Fix the nav\"}\n```\n\nLet me know!",
        )
        .expect("parses");
        assert_eq!(summary.headline, "Fix the nav");
    }

    #[test]
    fn a_brace_inside_a_string_does_not_truncate_the_object() {
        let summary = parse_summary(
            r#"{"headline":"Escape the { in the template","why":"It broke the parser."}"#,
        )
        .expect("parses");
        assert_eq!(summary.headline, "Escape the { in the template");
        assert_eq!(summary.why.as_deref(), Some("It broke the parser."));
    }

    #[test]
    fn an_escaped_quote_does_not_end_the_string_early() {
        let summary = parse_summary(r#"{"headline":"Fix the \"pricing\" copy","changes":[]}"#)
            .expect("parses");
        assert_eq!(summary.headline, r#"Fix the "pricing" copy"#);
    }

    #[test]
    fn refuses_a_field_the_schema_does_not_have() {
        // The same guard as the writer, applied at the point the agent's words
        // first enter the process.
        let err = parse_summary(r#"{"headline":"Fix","transcript":"the user said..."}"#)
            .expect_err("refuses");
        assert!(err.contains("transcript"), "{err}");
    }

    #[test]
    fn says_so_when_there_is_no_json_at_all() {
        assert!(parse_summary("I couldn't summarise that.").is_err());
        assert!(parse_summary(r#"{"headline":"unclosed"#).is_err());
    }

    #[test]
    fn the_prompt_says_who_reads_it_and_what_never_goes_in() {
        let prompt = build_prompt("M src/nav.tsx", "@@ -1 +1 @@");
        assert!(prompt.contains("Everyone with access reads it"));
        assert!(prompt.contains("Never quote the user"));
        assert!(prompt.contains("name the *setting*, never the value"));
        // The field the whole feature is for, said as such. A run against a
        // real diff dropped `why` and folded the reasoning into `changes`,
        // which turns a rich row back into a commit subject with extra steps.
        assert!(prompt.contains("`why` is the field that matters"));
        assert!(prompt.contains("must not be swapped"));
        // And it carries the context it is summarising.
        assert!(prompt.contains("src/nav.tsx"));
    }
}
