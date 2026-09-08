//! What a git remote actually points at.
//!
//! The app integrates with exactly one forge — GitHub, via `gh` — but a
//! project's `origin` can point anywhere. Before this module the only question
//! ever asked of a remote URL was "is this a GitHub repo?" ([`parse_github_repo`]
//! in `commands::github`), and every "no" collapsed into the same answer as
//! "this project has no remote at all". A GitLab project therefore rendered as
//! unconnected and was offered a GitHub repo to fix it.
//!
//! [`parse_remote`] keeps the two apart: it reports the host and path for any
//! remote it can parse, and names the forge *only* when the host says so.
//!
//! # Why there is no self-managed detection
//!
//! `gitlab.com` is GitLab. `git.acme.com` might be GitLab, Gitea, a bare git
//! server, or anything else — the URL cannot tell us, and neither can the
//! filesystem. Per the project's "Never Assume Data" rule those land in
//! [`GitForge::Unknown`], which the UI renders as "not GitHub" without putting
//! a guessed vendor name in front of the user. Naming the forge is a job for
//! something that actually asks the host, not for a substring match.
//!
//! [`parse_github_repo`]: crate::commands::github::parse_github_repo

/// The forge a remote's host identifies, where the host identifies one at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitForge {
    /// `github.com` — the forge the app's repo/PR features talk to.
    GitHub,
    /// `gitlab.com`. Recognised by name so copy can say "GitLab" rather than
    /// "this remote"; the app has no GitLab integration behind it.
    GitLab,
    /// A host we can read but cannot classify: self-managed instances, other
    /// forges, plain git servers. Known address, unknown vendor.
    Unknown,
}

/// A parsed git remote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRef {
    /// Bare hostname, lowercased, no port or userinfo (`gitlab.example.com`).
    pub host: String,
    /// Path to the repo with no leading slash or `.git` suffix. GitLab
    /// subgroups keep their full depth (`group/subgroup/repo`).
    pub path: String,
    /// What [`host`](Self::host) identifies, if anything.
    pub forge: GitForge,
}

impl RemoteRef {
    /// Whether the app's GitHub integration applies to this remote.
    pub fn is_github(&self) -> bool {
        self.forge == GitForge::GitHub
    }

    /// The forge's name for the user, when one is known.
    ///
    /// `None` for [`GitForge::Unknown`] — the caller shows the bare host
    /// instead of inventing a vendor.
    pub fn forge_name(&self) -> Option<&'static str> {
        match self.forge {
            GitForge::GitHub => Some("GitHub"),
            GitForge::GitLab => Some("GitLab"),
            GitForge::Unknown => None,
        }
    }
}

/// Classify a hostname. Exact matches only — see the module docs.
fn forge_for_host(host: &str) -> GitForge {
    match host {
        "github.com" | "www.github.com" => GitForge::GitHub,
        "gitlab.com" | "www.gitlab.com" => GitForge::GitLab,
        _ => GitForge::Unknown,
    }
}

/// Strip a trailing `.git` and any surrounding slashes from a repo path.
fn clean_path(path: &str) -> String {
    let path = path.trim_matches('/');
    path.strip_suffix(".git").unwrap_or(path).to_string()
}

/// Parse a git remote URL into its host and repo path.
///
/// Handles the forms git itself writes and accepts:
/// - `https://host/owner/repo.git` (and `http://`, and with `user@` / `:port`)
/// - `ssh://git@host:22/owner/repo.git`
/// - `git@host:owner/repo.git` (scp-like syntax)
/// - `git://host/owner/repo.git`
///
/// Returns `None` for local paths, `file://` URLs, and anything without both a
/// host and a non-empty path — none of which a forge integration applies to.
pub fn parse_remote(url: &str) -> Option<RemoteRef> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    // A local path or file:// remote has no forge. Checked before the scp-like
    // branch below, which would otherwise read `C:\repos\thing` as host `C`.
    if url.starts_with("file://") || url.starts_with('/') || url.starts_with('.') {
        return None;
    }

    let (authority, path) = if let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("ssh://"))
        .or_else(|| url.strip_prefix("git://"))
    {
        // scheme://[user@]host[:port]/path
        let (authority, path) = rest.split_once('/')?;
        (authority, path)
    } else if let Some((authority, path)) = url.split_once(':') {
        // scp-like: [user@]host:path. Windows drive letters (`C:\…`) and any
        // other single-character "host" are not remotes.
        let host_part = authority.rsplit('@').next().unwrap_or(authority);
        if host_part.len() < 2 || !host_part.contains('.') {
            return None;
        }
        (authority, path)
    } else {
        return None;
    };

    // Drop userinfo (`git@`) and any port.
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_lowercase();
    if host.is_empty() {
        return None;
    }

    let path = clean_path(path);
    if path.is_empty() {
        return None;
    }

    Some(RemoteRef {
        forge: forge_for_host(&host),
        host,
        path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(url: &str) -> RemoteRef {
        parse_remote(url).unwrap_or_else(|| panic!("expected {url} to parse"))
    }

    #[test]
    fn parses_https_github_remotes() {
        let r = parsed("https://github.com/owner/repo.git");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.path, "owner/repo");
        assert_eq!(r.forge, GitForge::GitHub);
        assert!(r.is_github());
    }

    #[test]
    fn parses_https_remotes_without_the_git_suffix() {
        assert_eq!(parsed("https://github.com/owner/repo").path, "owner/repo");
    }

    #[test]
    fn parses_scp_like_ssh_remotes() {
        let r = parsed("git@github.com:owner/repo.git");
        assert_eq!(r.host, "github.com");
        assert_eq!(r.path, "owner/repo");
        assert_eq!(r.forge, GitForge::GitHub);
    }

    #[test]
    fn parses_ssh_scheme_remotes_with_a_port() {
        let r = parsed("ssh://git@gitlab.com:22/group/repo.git");
        assert_eq!(r.host, "gitlab.com");
        assert_eq!(r.path, "group/repo");
        assert_eq!(r.forge, GitForge::GitLab);
    }

    #[test]
    fn gitlab_com_is_named_but_not_github() {
        let r = parsed("https://gitlab.com/owner/repo.git");
        assert_eq!(r.forge, GitForge::GitLab);
        assert!(!r.is_github());
        assert_eq!(r.forge_name(), Some("GitLab"));
    }

    #[test]
    fn gitlab_subgroups_keep_their_full_path() {
        // GitLab nests groups arbitrarily deep; truncating to owner/repo would
        // address the wrong project.
        let r = parsed("https://gitlab.com/acme/platform/web/app.git");
        assert_eq!(r.path, "acme/platform/web/app");
    }

    #[test]
    fn self_managed_hosts_are_unknown_not_guessed() {
        // The whole point: a host we cannot classify keeps its address and
        // admits it has no vendor name, rather than being sniffed for
        // "gitlab" and labelled on a substring match.
        let r = parsed("https://git.acme.com/team/repo.git");
        assert_eq!(r.host, "git.acme.com");
        assert_eq!(r.forge, GitForge::Unknown);
        assert_eq!(r.forge_name(), None);

        let r = parsed("https://gitlab.acme.com/team/repo.git");
        assert_eq!(r.forge, GitForge::Unknown);
        assert_eq!(r.forge_name(), None);
    }

    #[test]
    fn hosts_are_lowercased() {
        assert_eq!(
            parsed("https://GitHub.com/Owner/Repo.git").host,
            "github.com"
        );
        // Only the host is normalised: repo paths are case-sensitive.
        assert_eq!(
            parsed("https://GitHub.com/Owner/Repo.git").path,
            "Owner/Repo"
        );
    }

    #[test]
    fn rejects_local_paths_and_non_remotes() {
        assert_eq!(parse_remote(""), None);
        assert_eq!(parse_remote("   "), None);
        assert_eq!(parse_remote("not a url"), None);
        assert_eq!(parse_remote("/Users/me/repos/thing"), None);
        assert_eq!(parse_remote("./thing"), None);
        assert_eq!(parse_remote("file:///Users/me/repos/thing"), None);
        // A Windows drive letter is not a host.
        assert_eq!(parse_remote(r"C:\repos\thing"), None);
    }

    #[test]
    fn rejects_urls_with_a_host_but_no_repo() {
        assert_eq!(parse_remote("https://github.com/"), None);
        assert_eq!(parse_remote("https://github.com"), None);
    }
}
