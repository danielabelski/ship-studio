//! Reading `.shipstudio-team/` — the authored half.
//!
//! One record per file, written once, never modified:
//!
//! ```text
//! .shipstudio-team/updates/2026-09-07/01K4J8Q20001ABCDEFGHJKMNPQ-mayareed.json
//! ```
//!
//! Two people writing in the same second produce two different files, so git
//! merges them with no conflict — by construction rather than by luck. Put the
//! same data in one `activity.json` and every concurrent write is a merge
//! conflict in a JSON blob, which is the failure that ends the feature in week
//! one.
//!
//! Mutation is an append too. Resolving a comment writes a `resolve` record
//! rather than editing the `comment` record, and the current state of a thread
//! is a **fold** over its records computed here at read time. That is the only
//! form that survives two people acting at once: both files land, the fold
//! takes the later one, and nobody's work is lost to a merge.
//!
//! ## Forward compatibility is a hard requirement, not a nicety
//!
//! These files come off a git remote, written by teammates on versions of Ship
//! Studio that do not exist yet. A record this build does not understand is
//! **skipped**, never fatal: one person upgrading must not blank the feed for
//! everyone who has not. Hence `#[serde(default)]` throughout, an ignored
//! unknown field, and an `Unknown` catch-all kind.
//!
//! The strict schema lives on the write path, where an agent's output is
//! checked before anything is committed. Lenient in, strict out.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

use super::{TeamActor, TeamMessage, TeamThread, TeamUpdateAuthor};

/// A record's author, as written into the file.
#[derive(Debug, Clone, Deserialize)]
pub struct RecordActor {
    #[serde(default)]
    pub login: Option<String>,
    #[serde(default)]
    pub name: String,
}

impl RecordActor {
    /// The stored half of an actor. Avatars are never stored — they are a
    /// GitHub URL that rotates, and a stale one in committed history renders a
    /// broken image forever.
    fn to_actor(&self) -> TeamActor {
        TeamActor {
            login: self.login.clone().filter(|s| !s.is_empty()),
            name: if self.name.is_empty() {
                self.login.clone().unwrap_or_else(|| "Unknown".to_string())
            } else {
                self.name.clone()
            },
            avatar_url: None,
        }
    }
}

/// What a record says happened.
///
/// `Unknown` is load-bearing: a future kind deserializes into it and is skipped
/// rather than failing the whole directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RecordKind {
    /// Someone did a piece of work and said what it was.
    Update,
    /// A new comment thread anchored to something in the preview.
    Comment,
    /// A message on an existing thread.
    Reply,
    /// A thread was resolved or reopened.
    Resolve,
    #[serde(other)]
    #[default]
    Unknown,
}

/// One file under `.shipstudio-team/updates/`.
///
/// Every field past the envelope is optional because a record of one kind
/// carries none of another kind's fields, and because a field this build has
/// never heard of must not stop the file from being read.
#[derive(Debug, Clone, Deserialize)]
pub struct TeamRecord {
    /// Schema version. Bumped only for a change that older builds cannot read
    /// past; the lenient parse means most additions do not need one.
    #[serde(default = "one")]
    pub v: u32,
    #[serde(default)]
    pub kind: RecordKind,
    #[serde(default)]
    pub id: String,
    /// Unix milliseconds, author's clock.
    #[serde(default)]
    pub at: i64,
    #[serde(default)]
    pub actor: Option<RecordActor>,
    /// Which agent wrote it. `None` means a person did.
    #[serde(default)]
    pub agent: Option<String>,

    // ---- update ----
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub why: Option<String>,
    #[serde(default)]
    pub changes: Vec<String>,
    #[serde(default)]
    pub asks: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,

    // ---- comment / reply / resolve ----
    /// The thread this record belongs to. A `comment` starts one, so its
    /// thread id is its own id.
    #[serde(default)]
    pub thread: Option<String>,
    #[serde(default)]
    pub route: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub pin: Option<u32>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub resolved: Option<bool>,
}

fn one() -> u32 {
    1
}

/// The highest schema version this build understands.
const SUPPORTED_VERSION: u32 = 1;

impl TeamRecord {
    /// Whether this build can act on the record at all.
    ///
    /// A record from the future is shown as nothing rather than as a guess.
    /// It stays on disk and a later build will read it — nothing is lost, and
    /// nothing is invented in the meantime.
    pub fn is_readable(&self) -> bool {
        self.v <= SUPPORTED_VERSION && self.kind != RecordKind::Unknown && !self.id.is_empty()
    }

    pub fn actor(&self) -> TeamActor {
        self.actor
            .as_ref()
            .map(RecordActor::to_actor)
            .unwrap_or_else(|| TeamActor {
                login: None,
                name: "Unknown".to_string(),
                avatar_url: None,
            })
    }

    pub fn written_by(&self) -> TeamUpdateAuthor {
        if self.agent.is_some() {
            TeamUpdateAuthor::Agent
        } else {
            TeamUpdateAuthor::Person
        }
    }
}

/// Read every record under `<project>/.shipstudio-team/updates/`.
///
/// Returns them oldest-first, which is the order a fold needs: later records
/// win, and ULIDs sort chronologically, so lexical order over `<date>/<ulid>`
/// *is* chronological order without parsing a single timestamp.
///
/// A missing directory is the normal state for a repo nobody has used Ship
/// Studio on. It returns empty, not an error.
pub fn read_records(project: &Path) -> Vec<TeamRecord> {
    let root = project.join(super::TEAM_DIR).join("updates");
    let Ok(days) = std::fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut day_dirs: Vec<std::path::PathBuf> = days
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    day_dirs.sort();

    let mut records = Vec::new();
    for day in day_dirs {
        let Ok(entries) = std::fs::read_dir(&day) else {
            continue;
        };
        let mut files: Vec<std::path::PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        files.sort();

        for file in files {
            let Ok(raw) = std::fs::read_to_string(&file) else {
                continue;
            };
            match serde_json::from_str::<TeamRecord>(&raw) {
                Ok(record) if record.is_readable() => records.push(record),
                Ok(_) => {
                    tracing::debug!(file = %file.display(), "team record skipped: unreadable version or kind");
                }
                Err(error) => {
                    // A corrupt or half-written file is one lost row, not a
                    // broken feed. It is logged rather than surfaced: the user
                    // did not write it and cannot fix it.
                    tracing::warn!(file = %file.display(), %error, "team record failed to parse");
                }
            }
        }
    }
    records
}

/// Updates keyed by id, for joining against a commit's `Ship-Studio-Update`
/// trailer.
pub fn updates_by_id(records: &[TeamRecord]) -> HashMap<String, &TeamRecord> {
    records
        .iter()
        .filter(|record| record.kind == RecordKind::Update)
        .map(|record| (record.id.clone(), record))
        .collect()
}

/// Every login that has ever written a record here.
///
/// This is what `usesShipStudio` is derived from. Nobody registers, nobody is
/// invited, and nobody's status is declared — you use Ship Studio if your
/// explanations are in the repo.
pub fn logins_with_records(records: &[TeamRecord]) -> std::collections::HashSet<String> {
    records
        .iter()
        .filter_map(|record| record.actor.as_ref()?.login.as_ref())
        .map(|login| login.to_lowercase())
        .collect()
}

/// Fold the comment-family records into threads.
///
/// The fold is the whole point of append-only. A `comment` opens a thread, a
/// `reply` adds to it, a `resolve` flips a flag — and if two people resolve the
/// same thread from different machines, both records land and the later one
/// wins, deterministically, on every clone.
///
/// ## Why this is two passes
///
/// A one-pass fold drops a reply that is read before the comment it answers,
/// which sounds impossible — ULIDs sort chronologically, so a reply's file
/// always sorts after its comment's — right up until two machines disagree
/// about what time it is. The model already concedes clock skew (there is no
/// server clock to correct against), and skew is exactly what puts a reply in
/// an earlier day directory than the thread it belongs to.
///
/// Opening every thread first makes the result independent of read order, which
/// is what a fold over an append-only log is supposed to be. A reply whose
/// comment is genuinely absent — not yet fetched, or on a branch this clone
/// does not have — is still dropped rather than used to conjure a thread with
/// no anchor, no route and no target. It reappears when the file does.
pub fn fold_threads(
    records: &[TeamRecord],
    project_name: &str,
    project_path: &str,
) -> Vec<TeamThread> {
    let mut threads: Vec<TeamThread> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();

    for record in records.iter().filter(|r| r.kind == RecordKind::Comment) {
        if index.contains_key(&record.id) {
            continue;
        }
        index.insert(record.id.clone(), threads.len());
        threads.push(TeamThread {
            id: record.id.clone(),
            project_name: project_name.to_string(),
            project_path: project_path.to_string(),
            branch: record.branch.clone().unwrap_or_default(),
            route: record.route.clone().unwrap_or_default(),
            target: record.target.clone().unwrap_or_default(),
            // Pins are numbered by the machine that placed them, so two people
            // can pick the same number. The fold does not renumber: a pin is
            // what the person who placed it sees on their own preview, and
            // silently changing it breaks the one thing the number is for.
            pin: record.pin.unwrap_or(0),
            resolved: false,
            resolved_by: None,
            messages: vec![TeamMessage {
                id: record.id.clone(),
                actor: record.actor(),
                at: record.at,
                body: record.body.clone().unwrap_or_default(),
                pending: None,
            }],
        });
    }

    // Resolves are applied in timestamp order, not file order, so the newest
    // decision wins even when the clocks that produced them disagree about
    // which file sorts first.
    let mut resolves: Vec<&TeamRecord> = records
        .iter()
        .filter(|r| r.kind == RecordKind::Resolve)
        .collect();
    resolves.sort_by_key(|record| record.at);

    for record in records.iter().filter(|r| r.kind == RecordKind::Reply) {
        let Some(&position) = record.thread.as_deref().and_then(|id| index.get(id)) else {
            continue;
        };
        threads[position].messages.push(TeamMessage {
            id: record.id.clone(),
            actor: record.actor(),
            at: record.at,
            body: record.body.clone().unwrap_or_default(),
            pending: None,
        });
    }

    for record in resolves {
        let Some(&position) = record.thread.as_deref().and_then(|id| index.get(id)) else {
            continue;
        };
        let resolved = record.resolved.unwrap_or(true);
        threads[position].resolved = resolved;
        threads[position].resolved_by = resolved.then(|| record.actor());
    }

    for thread in &mut threads {
        thread.messages.sort_by_key(|message| message.at);
    }
    threads
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> TeamRecord {
        serde_json::from_str(json).expect("parses")
    }

    #[test]
    fn ignores_a_field_it_has_never_heard_of() {
        let record = parse(
            r#"{"v":1,"kind":"update","id":"01A","at":1,"headline":"Hi",
                "somethingFromTheFuture":{"nested":true}}"#,
        );
        assert!(record.is_readable());
        assert_eq!(record.headline.as_deref(), Some("Hi"));
    }

    #[test]
    fn skips_a_kind_it_has_never_heard_of_without_failing() {
        let record = parse(r#"{"v":1,"kind":"reaction","id":"01A","at":1}"#);
        assert_eq!(record.kind, RecordKind::Unknown);
        assert!(!record.is_readable());
    }

    #[test]
    fn refuses_to_interpret_a_record_from_a_future_schema() {
        let record = parse(r#"{"v":99,"kind":"update","id":"01A","at":1,"headline":"Hi"}"#);
        assert!(!record.is_readable());
    }

    #[test]
    fn never_stores_an_avatar_url() {
        let record = parse(
            r#"{"v":1,"kind":"update","id":"01A","at":1,
                "actor":{"login":"mayareed","name":"Maya Reed","avatarUrl":"http://x/y.png"}}"#,
        );
        assert_eq!(record.actor().avatar_url, None);
        assert_eq!(record.actor().login.as_deref(), Some("mayareed"));
    }

    #[test]
    fn falls_back_to_the_login_when_a_record_carries_no_name() {
        let record =
            parse(r#"{"v":1,"kind":"update","id":"01A","at":1,"actor":{"login":"mayareed"}}"#);
        assert_eq!(record.actor().name, "mayareed");
    }

    #[test]
    fn an_agent_field_is_what_makes_a_record_agent_written() {
        let agent = parse(r#"{"v":1,"kind":"update","id":"01A","at":1,"agent":"Claude Code"}"#);
        assert_eq!(agent.written_by(), TeamUpdateAuthor::Agent);
        let person = parse(r#"{"v":1,"kind":"comment","id":"01A","at":1}"#);
        assert_eq!(person.written_by(), TeamUpdateAuthor::Person);
    }

    fn thread_records() -> Vec<TeamRecord> {
        vec![
            parse(
                r#"{"v":1,"kind":"comment","id":"t1","at":100,"route":"/pricing",
                    "target":"h1 · Simple pricing","pin":1,"branch":"feat/pricing",
                    "body":"Should this say per seat?","actor":{"login":"maya","name":"Maya Reed"}}"#,
            ),
            parse(
                r#"{"v":1,"kind":"reply","id":"r1","thread":"t1","at":200,"body":"Yes.",
                    "actor":{"login":"theo","name":"Theo Vance"}}"#,
            ),
        ]
    }

    #[test]
    fn folds_a_comment_and_its_reply_into_one_thread() {
        let threads = fold_threads(&thread_records(), "site", "/tmp/site");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].messages.len(), 2);
        assert_eq!(threads[0].route, "/pricing");
        assert!(!threads[0].resolved);
    }

    #[test]
    fn a_later_resolve_record_wins_and_reopening_clears_the_resolver() {
        let mut records = thread_records();
        records.push(parse(
            r#"{"v":1,"kind":"resolve","id":"x1","thread":"t1","at":300,"resolved":true,
                "actor":{"login":"theo","name":"Theo Vance"}}"#,
        ));
        records.push(parse(
            r#"{"v":1,"kind":"resolve","id":"x2","thread":"t1","at":400,"resolved":false,
                "actor":{"login":"maya","name":"Maya Reed"}}"#,
        ));
        let threads = fold_threads(&records, "site", "/tmp/site");
        assert!(!threads[0].resolved);
        assert!(threads[0].resolved_by.is_none());
    }

    #[test]
    fn drops_a_reply_whose_thread_has_not_arrived_rather_than_inventing_one() {
        let orphan = vec![parse(
            r#"{"v":1,"kind":"reply","id":"r9","thread":"missing","at":5,"body":"?"}"#,
        )];
        assert!(fold_threads(&orphan, "site", "/tmp/site").is_empty());
    }

    #[test]
    fn a_reply_read_before_its_comment_still_lands_on_the_thread() {
        // Clock skew between two machines can put a reply in an earlier day
        // directory than the comment it answers. The fold must not care.
        let mut records = thread_records();
        records.swap(0, 1);
        let threads = fold_threads(&records, "site", "/tmp/site");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].messages.len(), 2);
        // And they still read in the order they were written.
        assert_eq!(threads[0].messages[0].body, "Should this say per seat?");
        assert_eq!(threads[0].messages[1].body, "Yes.");
    }

    #[test]
    fn the_newest_resolve_wins_even_when_it_was_read_first() {
        let mut records = thread_records();
        records.push(parse(
            r#"{"v":1,"kind":"resolve","id":"x2","thread":"t1","at":400,"resolved":false}"#,
        ));
        records.push(parse(
            r#"{"v":1,"kind":"resolve","id":"x1","thread":"t1","at":300,"resolved":true,
                "actor":{"login":"theo","name":"Theo Vance"}}"#,
        ));
        let threads = fold_threads(&records, "site", "/tmp/site");
        assert!(!threads[0].resolved);
    }

    #[test]
    fn uses_ship_studio_is_derived_from_who_has_written_records() {
        let logins = logins_with_records(&thread_records());
        assert!(logins.contains("maya"));
        assert!(logins.contains("theo"));
        assert!(!logins.contains("enid"));
    }

    #[test]
    fn a_missing_directory_reads_as_no_records_not_an_error() {
        let dir = std::env::temp_dir().join(format!("ss-team-none-{}", std::process::id()));
        assert!(read_records(&dir).is_empty());
    }

    #[test]
    fn reads_records_in_lexical_order_which_is_chronological_order() {
        let root = std::env::temp_dir().join(format!("ss-team-read-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let day = root
            .join(super::super::TEAM_DIR)
            .join("updates")
            .join("2026-09-07");
        std::fs::create_dir_all(&day).expect("mkdir");
        std::fs::write(
            day.join("01B-maya.json"),
            r#"{"v":1,"kind":"update","id":"01B","at":200,"headline":"second"}"#,
        )
        .expect("write");
        std::fs::write(
            day.join("01A-theo.json"),
            r#"{"v":1,"kind":"update","id":"01A","at":100,"headline":"first"}"#,
        )
        .expect("write");
        // Not JSON at all. One bad file must not take the directory with it.
        std::fs::write(day.join("01C-broken.json"), "{ not json").expect("write");

        let records = read_records(&root);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].id, "01A");
        assert_eq!(records[1].id, "01B");
        let _ = std::fs::remove_dir_all(&root);
    }
}
