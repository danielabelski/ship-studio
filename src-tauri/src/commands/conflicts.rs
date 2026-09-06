//! # Merge Conflict Resolution Commands
//!
//! Commands for detecting and resolving merge conflicts.

use crate::commands::github::ensure_git_identity;
use crate::errors::CommandError;
use crate::types::{ConflictBlock, ConflictedFile};
use crate::utils::validate_project_path;

/// Parse git merge conflict markers from file content.
pub fn parse_conflicts(content: &str, all_lines: &[&str]) -> (Vec<ConflictBlock>, String, String) {
    let mut conflicts = Vec::new();
    let mut ours_branch = String::new();
    let mut theirs_branch = String::new();

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        // Look for conflict start marker
        if lines[i].starts_with("<<<<<<<") {
            let line_start = i as u32 + 1;

            // Extract branch name from marker
            if ours_branch.is_empty() {
                ours_branch = lines[i].trim_start_matches('<').trim().to_string();
                if ours_branch.is_empty() {
                    ours_branch = "current".to_string();
                }
            }

            let mut current_content = Vec::new();
            let mut incoming_content = Vec::new();
            let mut in_current = true;
            i += 1;

            while i < lines.len() {
                if lines[i].starts_with("=======") {
                    in_current = false;
                    i += 1;
                    continue;
                }
                if lines[i].starts_with(">>>>>>>") {
                    // Extract theirs branch name
                    if theirs_branch.is_empty() {
                        theirs_branch = lines[i].trim_start_matches('>').trim().to_string();
                        if theirs_branch.is_empty() {
                            theirs_branch = "incoming".to_string();
                        }
                    }
                    break;
                }

                if in_current {
                    current_content.push(lines[i]);
                } else {
                    incoming_content.push(lines[i]);
                }
                i += 1;
            }

            let line_end = i as u32 + 1;

            // Get context (3 lines before and after)
            let context_start = if line_start > 4 {
                line_start as usize - 4
            } else {
                0
            };
            let context_end = std::cmp::min(line_end as usize + 3, all_lines.len());

            let context_before: String = if context_start < (line_start as usize - 1) {
                all_lines[context_start..(line_start as usize - 1)]
                    .iter()
                    .filter(|l| !l.starts_with("<<<<<<<"))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            };

            let context_after: String = if (line_end as usize) < context_end {
                all_lines[(line_end as usize)..context_end]
                    .iter()
                    .filter(|l| !l.starts_with(">>>>>>>"))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            };

            conflicts.push(ConflictBlock {
                line_start,
                line_end,
                current_content: current_content.join("\n"),
                incoming_content: incoming_content.join("\n"),
                context_before,
                context_after,
            });
        }
        i += 1;
    }

    (conflicts, ours_branch, theirs_branch)
}

/// Why a conflicted path can't be resolved as a text merge, if it can't.
///
/// `git diff --name-only --diff-filter=U` can list paths that aren't regular
/// files on disk: submodule conflicts, file/directory type-change conflicts
/// (one side of the merge turned the path into a directory), or paths that
/// are gone locally. Reading those as text fails with an opaque I/O error
/// ("Is a directory", issue #528), so callers skip the text-merge flow for
/// them and surface this reason instead.
pub fn non_text_mergeable_reason(path: &std::path::Path) -> Option<String> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => None,
        Ok(meta) if meta.is_dir() => Some(
            "This conflict involves a folder (a submodule or a file/folder type change), so it \
             can't be resolved as a text merge here. Resolve it with git in a terminal, or hand \
             the merge to your agent."
                .to_string(),
        ),
        Ok(_) => Some(
            "This conflicted path isn't a regular text file, so it can't be resolved as a text \
             merge here. Resolve it with git in a terminal, or hand the merge to your agent."
                .to_string(),
        ),
        Err(_) => Some(
            "This conflicted file is missing on disk, so it can't be resolved as a text merge \
             here. Resolve it with git in a terminal, or hand the merge to your agent."
                .to_string(),
        ),
    }
}

/// Message used for the commit that finishes a Ship Studio conflict merge.
const MERGE_COMMIT_MESSAGE: &str = "Resolved merge conflicts via Ship Studio";

/// Run an index-mutating git invocation, retrying when it loses the
/// `.git/index.lock` race.
///
/// Ship Studio runs git concurrently with the user's own agent terminal and
/// with the background snapshot watcher's debounced `git stash create`, so
/// losing the index lock is routine rather than exotic. Every other
/// index-mutating call site in the app already retries
/// (#377/#567/#597/#639/#860); conflict resolution was the last one that
/// didn't, and it touches the working tree file-by-file while the watcher is
/// firing on every one of those writes (issue #882).
///
/// `git commit` and `git merge --abort` also take `HEAD.lock` and
/// `refs/heads/<branch>.lock`, which collide under exactly the same
/// concurrency (issue #567) — `is_index_lock_contention` matches all of them.
fn run_index_git(
    dir: &std::path::Path,
    args: &[&str],
    label: &'static str,
) -> Result<std::process::Output, CommandError> {
    crate::utils::output_retrying_index_lock(|| {
        let mut cmd = crate::utils::git_command_in(dir)?;
        cmd.args(args);
        crate::external_command::spawn_with_pressure_retry(label, || cmd.output())
    })
}

/// Stage a pathspec (see [`run_index_git`] for why it retries).
fn stage_path(dir: &std::path::Path, pathspec: &str) -> Result<std::process::Output, CommandError> {
    run_index_git(dir, &["add", pathspec], "git add")
}

/// Create the merge commit. `complete_merge` stages and then commits, so it
/// has two chances to lose the lock race in one flow (issue #882).
fn commit_merge(
    dir: &std::path::Path,
    message: &str,
) -> Result<std::process::Output, CommandError> {
    run_index_git(dir, &["commit", "-m", message], "git commit")
}

/// Get information about all conflicted files in the repository
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn get_conflict_info(project_path: String) -> Result<Vec<ConflictedFile>, CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    // Get list of files with unmerged changes
    let output = crate::utils::git_command_in(&validated_path)?
        .args(["diff", "--name-only", "--diff-filter=U"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err((format!("Failed to get conflicted files: {stderr}")).into());
    }

    let file_list = String::from_utf8_lossy(&output.stdout);
    let files: Vec<&str> = file_list.lines().filter(|l| !l.is_empty()).collect();

    let mut conflicted_files = Vec::new();

    for file in files {
        let file_path = validated_path.join(file);

        // Non-regular-file conflicts (submodules, file/folder type changes)
        // can't be parsed as a text merge — record them with a per-file
        // status instead of failing or silently dropping them (issue #528).
        if let Some(reason) = non_text_mergeable_reason(&file_path) {
            tracing::warn!(
                file = %file,
                "Conflicted path is not a regular file; skipping text-merge parsing"
            );
            conflicted_files.push(ConflictedFile {
                file_path: file.to_string(),
                is_binary: false,
                conflicts: Vec::new(),
                ours_branch: "current".to_string(),
                theirs_branch: "incoming".to_string(),
                unsupported_reason: Some(reason),
            });
            continue;
        }

        // Check if file is binary
        let is_binary = crate::utils::git_command_in(&validated_path)?
            .args(["diff", "--numstat", file])
            .output()
            .map(|out| {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout.starts_with("-\t-")
            })
            .unwrap_or(false);

        if is_binary {
            conflicted_files.push(ConflictedFile {
                file_path: file.to_string(),
                is_binary: true,
                conflicts: Vec::new(),
                ours_branch: "current".to_string(),
                theirs_branch: "incoming".to_string(),
                unsupported_reason: None,
            });
            continue;
        }

        // Read file content and parse conflicts
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(file = %file, "Failed to read conflicted file, skipping: {e}");
                continue;
            }
        };

        let all_lines: Vec<&str> = content.lines().collect();
        let (conflicts, ours_branch, theirs_branch) = parse_conflicts(&content, &all_lines);

        if !conflicts.is_empty() {
            conflicted_files.push(ConflictedFile {
                file_path: file.to_string(),
                is_binary: false,
                conflicts,
                ours_branch,
                theirs_branch,
                unsupported_reason: None,
            });
        }
    }

    Ok(conflicted_files)
}

/// Resolve a single conflict in a file by choosing current or incoming content
#[tauri::command]
#[tracing::instrument(skip(project_path, file_path, resolution), fields(project = %project_path, file = %file_path, conflict_index = conflict_index, resolution = %resolution))]
pub async fn resolve_conflict(
    project_path: String,
    file_path: String,
    conflict_index: u32,
    resolution: String, // "current" or "incoming"
) -> Result<(), CommandError> {
    let validated_path = validate_project_path(&project_path)?;
    let full_path = validated_path.join(&file_path);

    // A file/folder type-change or submodule conflict can't be text-merged;
    // reading it would fail with a raw "Is a directory" I/O error (issue
    // #528). This is a repository state, not an app bug — expected.
    if let Some(reason) = non_text_mergeable_reason(&full_path) {
        tracing::warn!(file = %file_path, "Conflicted path is not a regular file; refusing text-merge resolution");
        return Err(CommandError::expected(reason));
    }

    // Read the current file content
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read conflicted file `{file_path}`: {e}"))?;

    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::new();
    let mut i = 0;
    let mut current_conflict = 0;

    while i < lines.len() {
        if lines[i].starts_with("<<<<<<<") {
            if current_conflict == conflict_index {
                // Found the conflict to resolve
                let mut current_content = Vec::new();
                let mut incoming_content = Vec::new();
                let mut in_current = true;
                i += 1;

                while i < lines.len() {
                    if lines[i].starts_with("=======") {
                        in_current = false;
                        i += 1;
                        continue;
                    }
                    if lines[i].starts_with(">>>>>>>") {
                        break;
                    }

                    if in_current {
                        current_content.push(lines[i]);
                    } else {
                        incoming_content.push(lines[i]);
                    }
                    i += 1;
                }

                // Add the chosen resolution
                let chosen = if resolution == "current" {
                    &current_content
                } else {
                    &incoming_content
                };

                for line in chosen {
                    result.push(*line);
                }

                current_conflict += 1;
            } else {
                // Skip this conflict, keep it as-is
                result.push(lines[i]);
                current_conflict += 1;
            }
        } else {
            result.push(lines[i]);
        }
        i += 1;
    }

    // Write the modified content back
    let new_content = result.join("\n");
    let final_content = if content.ends_with('\n') {
        format!("{new_content}\n")
    } else {
        new_content
    };

    std::fs::write(&full_path, final_content)
        .map_err(|e| format!("Failed to write resolved file `{file_path}`: {e}"))?;

    // Check if there are any remaining conflicts in this file
    let updated_content = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read updated file `{file_path}`: {e}"))?;

    let has_more_conflicts = updated_content.contains("<<<<<<<");

    // If no more conflicts, stage the file
    if !has_more_conflicts {
        let add_output = stage_path(&validated_path, &file_path)?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err((format!("Failed to stage resolved file: {stderr}")).into());
        }
    }

    Ok(())
}

/// Abort the current merge and return to pre-merge state
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn abort_merge(project_path: String) -> Result<(), CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    // `merge --abort` rewrites the index and working tree, so it races the
    // snapshot watcher exactly like staging does (issue #882).
    let output = run_index_git(&validated_path, &["merge", "--abort"], "git merge --abort")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err((format!("Failed to abort merge: {stderr}")).into());
    }

    Ok(())
}

/// Complete the merge after all conflicts have been resolved
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn complete_merge(project_path: String) -> Result<(), CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    // Stage all changes
    let add_output = stage_path(&validated_path, ".")?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err((format!("Failed to stage changes: {stderr}")).into());
    }

    // Ensure git identity matches GitHub account before committing
    let _ = ensure_git_identity(&validated_path);

    // Create the merge commit
    let commit_output = commit_merge(&validated_path, MERGE_COMMIT_MESSAGE)?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if !stderr.contains("nothing to commit") {
            return Err((format!("Failed to create merge commit: {stderr}")).into());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Issue #882: conflict resolution's index writers must survive losing
    /// the `.git/index.lock` race, like every other git-mutating call site.
    mod index_lock_contention {
        use super::*;
        use std::process::Command;

        fn init_repo(dir: &std::path::Path) {
            Command::new("git")
                .args(["init", "-q", "-b", "main"])
                .current_dir(dir)
                .status()
                .unwrap();
            for (k, v) in [("user.name", "T"), ("user.email", "t@e.com")] {
                Command::new("git")
                    .args(["config", k, v])
                    .current_dir(dir)
                    .status()
                    .unwrap();
            }
            std::fs::write(dir.join("a.txt"), "v1").unwrap();
            Command::new("git")
                .args(["add", "-A"])
                .current_dir(dir)
                .status()
                .unwrap();
            Command::new("git")
                .args(["commit", "-q", "-m", "init"])
                .current_dir(dir)
                .status()
                .unwrap();
        }

        /// Hold `.git/index.lock` the way a concurrent git process would,
        /// then release it after `hold` — long enough that the first attempt
        /// must fail, short enough that a retrying caller wins.
        fn hold_index_lock(
            dir: &std::path::Path,
            hold: std::time::Duration,
        ) -> std::thread::JoinHandle<()> {
            let lock = dir.join(".git").join("index.lock");
            std::fs::write(&lock, b"").unwrap();
            std::thread::spawn(move || {
                std::thread::sleep(hold);
                let _ = std::fs::remove_file(&lock);
            })
        }

        #[test]
        fn stage_path_survives_a_transient_index_lock() {
            let tmp = tempfile::tempdir().unwrap();
            init_repo(tmp.path());
            std::fs::write(tmp.path().join("a.txt"), "resolved").unwrap();

            let releaser = hold_index_lock(tmp.path(), std::time::Duration::from_millis(100));
            let out = stage_path(tmp.path(), "a.txt").unwrap();
            releaser.join().unwrap();

            assert!(
                out.status.success(),
                "staging must retry past a transient index.lock, got: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            let staged = Command::new("git")
                .args(["diff", "--cached", "--name-only"])
                .current_dir(tmp.path())
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&staged.stdout).trim(), "a.txt");
        }

        #[test]
        fn commit_merge_survives_a_transient_index_lock() {
            let tmp = tempfile::tempdir().unwrap();
            init_repo(tmp.path());
            std::fs::write(tmp.path().join("a.txt"), "resolved").unwrap();
            Command::new("git")
                .args(["add", "-A"])
                .current_dir(tmp.path())
                .status()
                .unwrap();

            let releaser = hold_index_lock(tmp.path(), std::time::Duration::from_millis(100));
            let out = commit_merge(tmp.path(), MERGE_COMMIT_MESSAGE).unwrap();
            releaser.join().unwrap();

            assert!(
                out.status.success(),
                "commit must retry past a transient index.lock, got: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            let subject = Command::new("git")
                .args(["log", "-1", "--pretty=%s"])
                .current_dir(tmp.path())
                .output()
                .unwrap();
            assert_eq!(
                String::from_utf8_lossy(&subject.stdout).trim(),
                MERGE_COMMIT_MESSAGE
            );
        }

        /// A lock that never clears still surfaces as the caller's normal
        /// failure — the retry must not swallow persistent contention.
        #[test]
        fn a_persistent_index_lock_still_fails() {
            let tmp = tempfile::tempdir().unwrap();
            init_repo(tmp.path());
            std::fs::write(tmp.path().join("a.txt"), "resolved").unwrap();
            std::fs::write(tmp.path().join(".git").join("index.lock"), b"").unwrap();

            let out = stage_path(tmp.path(), "a.txt").unwrap();
            assert!(!out.status.success());
            assert!(crate::utils::is_index_lock_contention(
                &String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    fn parse(content: &str) -> (Vec<ConflictBlock>, String, String) {
        let all_lines: Vec<&str> = content.lines().collect();
        parse_conflicts(content, &all_lines)
    }

    #[test]
    fn no_markers_yields_no_conflicts() {
        let (conflicts, ours, theirs) = parse("line one\nline two\nline three");
        assert!(conflicts.is_empty());
        assert_eq!(ours, "");
        assert_eq!(theirs, "");
    }

    #[test]
    fn single_conflict_extracts_branches_and_content() {
        let content =
            "a\nb\nc\n<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> feature\nd\ne";
        let (conflicts, ours, theirs) = parse(content);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(ours, "HEAD");
        assert_eq!(theirs, "feature");

        let block = &conflicts[0];
        assert_eq!(block.current_content, "ours line");
        assert_eq!(block.incoming_content, "theirs line");
        // Marker line is the 4th line (1-based).
        assert_eq!(block.line_start, 4);
        // Context excludes the conflict markers themselves.
        assert!(block.context_before.contains('a'));
        assert!(!block.context_before.contains("<<<<<<<"));
        assert!(block.context_after.contains('d'));
        assert!(!block.context_after.contains(">>>>>>>"));
    }

    #[test]
    fn empty_marker_labels_fall_back_to_defaults() {
        let content = "<<<<<<<\nfoo\n=======\nbar\n>>>>>>>";
        let (conflicts, ours, theirs) = parse(content);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(ours, "current");
        assert_eq!(theirs, "incoming");
        assert_eq!(conflicts[0].current_content, "foo");
        assert_eq!(conflicts[0].incoming_content, "bar");
    }

    #[test]
    fn multiple_conflicts_are_all_parsed_with_first_branch_names() {
        let content = "x\n<<<<<<< HEAD\na1\n=======\nb1\n>>>>>>> feat\ny\n\
                       <<<<<<< HEAD\na2\n=======\nb2\n>>>>>>> feat\nz";
        let (conflicts, ours, theirs) = parse(content);

        assert_eq!(conflicts.len(), 2);
        assert_eq!(ours, "HEAD");
        assert_eq!(theirs, "feat");
        assert_eq!(conflicts[0].current_content, "a1");
        assert_eq!(conflicts[0].incoming_content, "b1");
        assert_eq!(conflicts[1].current_content, "a2");
        assert_eq!(conflicts[1].incoming_content, "b2");
    }

    #[test]
    fn regular_file_is_text_mergeable() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("conflicted.txt");
        std::fs::write(&file, "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n").unwrap();
        assert_eq!(non_text_mergeable_reason(&file), None);
    }

    #[test]
    fn directory_conflict_yields_folder_reason() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("was-a-file");
        std::fs::create_dir(&sub).unwrap();
        let reason = non_text_mergeable_reason(&sub).expect("directory must not be text-merged");
        assert!(
            reason.contains("folder"),
            "reason should mention folder: {reason}"
        );
    }

    #[test]
    fn missing_path_yields_missing_reason() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("deleted-locally.txt");
        let reason =
            non_text_mergeable_reason(&gone).expect("missing path must not be text-merged");
        assert!(
            reason.contains("missing"),
            "reason should mention missing: {reason}"
        );
    }

    #[test]
    fn multiline_conflict_sides_join_with_newlines() {
        let content = "<<<<<<< HEAD\nl1\nl2\n=======\nr1\nr2\nr3\n>>>>>>> other";
        let (conflicts, _ours, _theirs) = parse(content);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].current_content, "l1\nl2");
        assert_eq!(conflicts[0].incoming_content, "r1\nr2\nr3");
    }
}
