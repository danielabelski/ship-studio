//! Real repositories, a real remote, two real clones.
//!
//! The unit tests beside [`super::transport`] check its string handling. They
//! cannot check the thing that actually matters — that a comment written on one
//! machine arrives on another, and that nothing this module does is visible in
//! the user's own working tree. Those are properties of git, so these use git:
//! a bare origin and two clones of it, exchanging records the way two people
//! would.

use super::transport::{exclude_threads_from_working_tree, sync};

/// What the local clone knows about the shared ref.
///
/// Deliberately the remote-tracking ref: no local `shipstudio-team` branch is
/// ever created, so the feature never shows up in the user's branch list or
/// their branch switcher.
const MIRROR: &str = "refs/remotes/origin/shipstudio-team";
use std::path::{Path, PathBuf};
use std::process::Command;

struct Sandbox {
    root: PathBuf,
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn run(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?} failed in {}: {}",
        dir.display(),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

impl Sandbox {
    /// A bare origin plus two clones, each configured as a different person.
    fn new(tag: &str) -> (Self, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "ss-transport-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("mkdir");

        let origin = root.join("origin.git");
        std::fs::create_dir_all(&origin).expect("mkdir origin");
        run(
            &root,
            &["init", "--bare", "--initial-branch=main", "origin.git"],
        );

        let maya = clone(&root, &origin, "maya", "Maya Reed", "maya@x.com");
        // One commit so the remote has a main branch, as any real repo would.
        std::fs::write(maya.join("README.md"), "hello\n").unwrap();
        run(&maya, &["add", "-A"]);
        run(&maya, &["commit", "-m", "first"]);
        run(&maya, &["push", "-u", "origin", "main"]);

        let theo = clone(&root, &origin, "theo", "Theo Vance", "theo@x.com");
        (Sandbox { root }, maya, theo)
    }
}

fn clone(root: &Path, origin: &Path, name: &str, who: &str, email: &str) -> PathBuf {
    run(root, &["clone", "--quiet", origin.to_str().unwrap(), name]);
    let dir = root.join(name);
    run(&dir, &["config", "user.name", who]);
    run(&dir, &["config", "user.email", email]);
    dir
}

/// Write a comment record the way `threads.rs` does.
fn write_record(project: &Path, id: &str, login: &str, body: &str) {
    let dir = project
        .join(".shipstudio-team")
        .join("threads")
        .join("2026-09-07");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("{id}-{login}.json")),
        format!(
            r#"{{"v":1,"kind":"comment","id":"{id}","at":1757000000000,
                "actor":{{"login":"{login}","name":"{login}"}},
                "route":"/","target":"h1","body":"{body}"}}"#
        ),
    )
    .unwrap();
}

fn record_files(project: &Path) -> Vec<String> {
    let dir = project.join(".shipstudio-team").join("threads");
    let mut out = Vec::new();
    for day in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        for file in std::fs::read_dir(day.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            out.push(file.file_name().to_string_lossy().into_owned());
        }
    }
    out.sort();
    out
}

#[tokio::test]
async fn a_comment_written_on_one_machine_arrives_on_another() {
    let (_sandbox, maya, theo) = Sandbox::new("exchange");

    write_record(&maya, "01AAA", "mayareed", "Should this say seats?");
    let sent = sync(&maya, "Maya Reed", true).await;
    assert_eq!(sent.error, None, "push failed");
    assert_eq!(sent.pushed, 1);
    assert_eq!(sent.pending, 0);

    // Theo has never seen this repository's comments before.
    let received = sync(&theo, "Theo Vance", true).await;
    assert_eq!(received.error, None);
    assert_eq!(received.pulled, 1);
    assert_eq!(record_files(&theo), vec!["01AAA-mayareed.json"]);
}

#[tokio::test]
async fn two_people_commenting_at_once_keep_both_comments() {
    let (_sandbox, maya, theo) = Sandbox::new("concurrent");

    // Both write before either syncs — the case a shared file would lose.
    write_record(&maya, "01AAA", "mayareed", "mine");
    write_record(&theo, "01BBB", "theovance", "also mine");

    assert_eq!(sync(&maya, "Maya Reed", true).await.error, None);
    let theos = sync(&theo, "Theo Vance", true).await;
    assert_eq!(theos.error, None);

    // Theo pulled Maya's and pushed his own in one pass.
    assert_eq!(theos.pulled, 1);
    assert_eq!(theos.pushed, 1);
    assert_eq!(
        record_files(&theo),
        vec!["01AAA-mayareed.json", "01BBB-theovance.json"]
    );

    // And Maya gets Theo's on her next sync, with nothing of hers lost.
    let mayas = sync(&maya, "Maya Reed", true).await;
    assert_eq!(mayas.pulled, 1);
    assert_eq!(
        record_files(&maya),
        vec!["01AAA-mayareed.json", "01BBB-theovance.json"]
    );
}

#[tokio::test]
async fn syncing_never_touches_the_branch_the_user_is_on() {
    let (_sandbox, maya, _theo) = Sandbox::new("untouched");

    // A dirty tree with something staged, which is the state this must survive.
    std::fs::write(maya.join("README.md"), "edited\n").unwrap();
    std::fs::write(maya.join("staged.txt"), "staged\n").unwrap();
    run(&maya, &["add", "staged.txt"]);

    let head_before = run(&maya, &["rev-parse", "HEAD"]);
    let status_before = run(&maya, &["status", "--porcelain"]);
    let branch_before = run(&maya, &["rev-parse", "--abbrev-ref", "HEAD"]);

    write_record(&maya, "01AAA", "mayareed", "note");
    assert_eq!(sync(&maya, "Maya Reed", true).await.error, None);

    assert_eq!(
        run(&maya, &["rev-parse", "HEAD"]),
        head_before,
        "HEAD moved"
    );
    assert_eq!(
        run(&maya, &["rev-parse", "--abbrev-ref", "HEAD"]),
        branch_before,
        "branch changed"
    );
    assert_eq!(
        run(&maya, &["status", "--porcelain"]),
        status_before,
        "the working tree or index changed"
    );
}

#[tokio::test]
async fn comment_records_never_appear_in_the_users_own_git_status() {
    let (_sandbox, maya, _theo) = Sandbox::new("excluded");

    write_record(&maya, "01AAA", "mayareed", "note");
    assert_eq!(sync(&maya, "Maya Reed", true).await.error, None);

    let status = run(&maya, &["status", "--porcelain"]);
    assert!(
        !status.contains(".shipstudio-team"),
        "comment records leaked into the user's status: {status}"
    );
}

#[tokio::test]
async fn the_exclude_entry_is_written_once_and_keeps_what_was_already_there() {
    let (_sandbox, maya, _theo) = Sandbox::new("exclude-idempotent");
    let exclude = maya.join(".git").join("info").join("exclude");
    std::fs::create_dir_all(exclude.parent().unwrap()).unwrap();
    std::fs::write(&exclude, "# theirs\n*.log\n").unwrap();

    exclude_threads_from_working_tree(&maya).unwrap();
    exclude_threads_from_working_tree(&maya).unwrap();

    let text = std::fs::read_to_string(&exclude).unwrap();
    assert!(
        text.contains("*.log"),
        "the user's own entries were dropped"
    );
    assert_eq!(
        text.matches(".shipstudio-team/threads/").count(),
        1,
        "the entry was appended twice"
    );
}

#[tokio::test]
async fn a_project_with_no_remote_keeps_its_comments_and_says_they_are_unshared() {
    let (_sandbox, maya, _theo) = Sandbox::new("no-remote");
    run(&maya, &["remote", "remove", "origin"]);

    write_record(&maya, "01AAA", "mayareed", "note");
    let outcome = sync(&maya, "Maya Reed", false).await;

    assert_eq!(outcome.error, None, "a missing remote is not an error");
    assert_eq!(outcome.pushed, 0);
    assert_eq!(outcome.pending, 1, "the record is real and unshared");
    assert_eq!(record_files(&maya), vec!["01AAA-mayareed.json"]);
}

#[tokio::test]
async fn a_remote_that_rejects_the_push_keeps_the_comments_and_explains() {
    let (_sandbox, maya, _theo) = Sandbox::new("rejected");
    run(
        &maya,
        &["remote", "set-url", "origin", "/nonexistent/repo.git"],
    );

    write_record(&maya, "01AAA", "mayareed", "note");
    let outcome = sync(&maya, "Maya Reed", true).await;

    assert!(outcome.error.is_some(), "a broken remote must be reported");
    assert_eq!(outcome.pending, 1);
    assert_eq!(
        record_files(&maya),
        vec!["01AAA-mayareed.json"],
        "the person's words must survive a failed push"
    );
}

#[tokio::test]
async fn syncing_twice_with_nothing_new_pushes_nothing() {
    let (_sandbox, maya, _theo) = Sandbox::new("idempotent");

    write_record(&maya, "01AAA", "mayareed", "note");
    assert_eq!(sync(&maya, "Maya Reed", true).await.pushed, 1);

    let again = sync(&maya, "Maya Reed", true).await;
    assert_eq!(again.pushed, 0, "an unchanged sync must not commit again");
    assert_eq!(again.pending, 0);
    assert_eq!(again.error, None);

    // One commit on the ref, not two.
    let count = run(&maya, &["rev-list", "--count", MIRROR]);
    assert_eq!(count, "1", "an empty commit was pushed to the shared ref");
}

#[tokio::test]
async fn the_comment_ref_carries_only_comment_records() {
    let (_sandbox, maya, _theo) = Sandbox::new("only-records");

    // A file the user is working on, which must never end up on the shared ref.
    std::fs::write(maya.join("secret.env"), "TOKEN=abc\n").unwrap();
    write_record(&maya, "01AAA", "mayareed", "note");
    assert_eq!(sync(&maya, "Maya Reed", true).await.error, None);

    let listed = run(&maya, &["ls-tree", "-r", "--name-only", MIRROR]);
    assert_eq!(
        listed,
        ".shipstudio-team/threads/2026-09-07/01AAA-mayareed.json"
    );
}

#[tokio::test]
async fn a_record_that_arrived_from_someone_else_is_not_pushed_back() {
    let (_sandbox, maya, theo) = Sandbox::new("no-echo");

    write_record(&maya, "01AAA", "mayareed", "hers");
    sync(&maya, "Maya Reed", true).await;

    // Theo pulls it, then syncs again with nothing of his own to add.
    sync(&theo, "Theo Vance", true).await;
    let second = sync(&theo, "Theo Vance", true).await;
    assert_eq!(second.pushed, 0);
    assert_eq!(second.pending, 0);
    assert_eq!(run(&theo, &["rev-list", "--count", MIRROR]), "1");
}
