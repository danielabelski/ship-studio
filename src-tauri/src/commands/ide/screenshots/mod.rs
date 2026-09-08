//! # Screenshot and Playwright Commands
//!
//! Commands for capturing project thumbnails, full-page and viewport screenshots,
//! and image cropping.
//!
//! Organized into submodules:
//! - `base` — crop and read as base64
//! - `playwright` — Playwright environment management, full-page and viewport captures
//! - `thumbnail` — project thumbnail capture and retrieval
//! - `webview_snapshot` — native in-app preview snapshot (no headless browser)

mod base;
mod playwright;
mod thumbnail;
mod webview_snapshot;

pub use base::*;
pub use playwright::*;
pub use thumbnail::*;
pub use webview_snapshot::*;

/// Quick TCP probe of the dev-server port in `url` (IPv4 and IPv6 — some dev
/// servers, especially Vite, bind only IPv6; 500ms timeout each). Callers use
/// this to fail fast with a clean "dev server not ready" message instead of
/// letting Playwright's `page.goto` blow up with an ERR_CONNECTION_REFUSED
/// stack trace (issue #349). Port defaults to 3000 when the URL carries none.
///
/// The two families are raced concurrently rather than tried in sequence: a
/// port nothing is listening on yet can make each `connect_timeout` actually
/// burn its full 500ms instead of returning an instant refusal — Windows
/// especially doesn't refuse a closed loopback port immediately, unlike
/// Unix — so a serial ipv4-then-ipv6 probe could cost up to 1s per check
/// against a slow-starting dev server (issue #711, a Windows-specific
/// recurrence of #614).
pub(crate) fn dev_server_listening(url: &str) -> bool {
    use std::net::TcpStream;
    use std::time::Duration;

    let port: u16 = url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next_back()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let ipv4_addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let ipv6_addr = std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port));

    std::thread::scope(|scope| {
        let v6 = scope.spawn(move || {
            TcpStream::connect_timeout(&ipv6_addr, Duration::from_millis(500)).is_ok()
        });
        let v4_ok = TcpStream::connect_timeout(&ipv4_addr, Duration::from_millis(500)).is_ok();
        v4_ok || v6.join().unwrap_or(false)
    })
}

/// [`dev_server_listening`], retried once after a short backoff before giving
/// up. A dev server that's mid-boot (compiling, resolving deps) can still
/// fail the first probe and be answering a second later — treating one miss
/// as final is the other half of issue #711/#614's thumbnail-capture misses.
pub(crate) async fn dev_server_listening_with_retry(url: &str) -> bool {
    if dev_server_listening(url) {
        return true;
    }
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    dev_server_listening(url)
}

use crate::utils::{create_command, find_executable, get_extended_path};
use std::process::Command;

/// Build a command for a Node-ecosystem tool (`npm` / `npx` / `node`) with the
/// extended PATH. Resolves the binary via `find_executable` first — on Windows
/// npm and npx ship as `.cmd` shims, which `Command::new("npm")` can never
/// launch (Rust's PATH search only appends `.exe`). Falls back to the bare
/// name if resolution fails. Mirrors `mobile.rs::npx_command()`.
pub(super) fn node_tool_command(bin: &str) -> Command {
    let mut cmd = if let Some(path) = find_executable(bin) {
        create_command(path)
    } else {
        create_command(bin)
    };
    cmd.env("PATH", get_extended_path());
    cmd
}

#[cfg(test)]
mod tests {
    use super::node_tool_command;
    use crate::utils::get_extended_path;
    use std::ffi::OsStr;

    #[test]
    fn falls_back_to_bare_name_when_binary_not_found() {
        let cmd = node_tool_command("this-binary-definitely-does-not-exist-54321");
        assert_eq!(
            cmd.get_program(),
            OsStr::new("this-binary-definitely-does-not-exist-54321")
        );
    }

    #[test]
    fn sets_extended_path_env() {
        let cmd = node_tool_command("this-binary-definitely-does-not-exist-54321");
        let path_env = cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("PATH"))
            .and_then(|(_, value)| value);
        let extended = get_extended_path();
        assert_eq!(path_env, Some(OsStr::new(extended.as_str())));
    }

    #[test]
    fn resolves_to_absolute_path_when_binary_exists() {
        // `cargo` is guaranteed to be findable while running `cargo test`.
        // Skip (rather than fail) if resolution misses on an exotic setup.
        if crate::utils::find_executable("cargo").is_none() {
            return;
        }
        let cmd = node_tool_command("cargo");
        assert!(
            std::path::Path::new(cmd.get_program()).is_absolute(),
            "expected an absolute resolved path, got {:?}",
            cmd.get_program()
        );
    }

    #[test]
    fn dev_server_listening_reflects_whether_anything_is_bound() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(super::dev_server_listening(&format!(
            "http://localhost:{port}"
        )));
        drop(listener);

        // The negative half has an unavoidable race: the moment an ephemeral
        // port is released the OS may hand it straight to something else —
        // another test in this binary, a dev server, anything on the machine —
        // and this asserted on the first one it tried. That failed a full-suite
        // run roughly never, which is the worst frequency for a test to fail
        // at. Several distinct freed ports instead: all of them being re-bound
        // inside the same instant is not a thing that happens.
        let freed_reads_as_closed = (0..5).any(|_| {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let p = l.local_addr().unwrap().port();
            drop(l);
            !super::dev_server_listening(&format!("http://localhost:{p}"))
        });
        assert!(
            freed_reads_as_closed,
            "every freed port still read as listening — the check is not detecting a closed port"
        );
    }

    /// Issue #711/#614: a dev server that's still starting up can miss the
    /// health check's first probe and be listening a moment later. The retry
    /// must catch that case rather than treating one miss as final.
    #[tokio::test]
    async fn dev_server_listening_with_retry_catches_a_server_that_starts_during_the_backoff() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let url = format!("http://localhost:{port}");
        assert!(
            !super::dev_server_listening(&url),
            "nothing should be listening yet"
        );

        // Simulate a dev server finishing its boot partway through the
        // retry's ~1s backoff window.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let listener = std::net::TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
            std::thread::sleep(std::time::Duration::from_secs(2));
            drop(listener);
        });

        assert!(
            super::dev_server_listening_with_retry(&url).await,
            "the retry's second probe should catch the now-listening server"
        );
    }
}
