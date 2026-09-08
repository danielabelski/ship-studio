/**
 * Tests for the remote-naming helpers.
 *
 * These exist to keep one rule enforceable in one place: the app never puts
 * the word "GitHub" in front of a project whose code isn't on GitHub, and
 * never invents a vendor name for a host it couldn't classify.
 */

import { describe, it, expect } from 'vitest';
import { remoteLabel, hasPushableRemote, type ProjectGitHubStatus } from './github';

function status(overrides: Partial<ProjectGitHubStatus>): ProjectGitHubStatus {
  return {
    status: 'no-remote',
    github_repo: null,
    github_url: null,
    remote_host: null,
    remote_forge: null,
    ...overrides,
  };
}

describe('remoteLabel', () => {
  it('names GitHub for a connected project', () => {
    expect(remoteLabel(status({ status: 'connected', github_repo: 'a/b' }))).toBe('GitHub');
  });

  it('names the forge when the host identifies one', () => {
    expect(
      remoteLabel(
        status({ status: 'other-remote', remote_host: 'gitlab.com', remote_forge: 'GitLab' })
      )
    ).toBe('GitLab');
  });

  it('falls back to the bare host rather than guessing a vendor', () => {
    // A self-managed instance could be GitLab, Gitea, or a plain git server.
    // Showing the address is honest; showing "GitLab" because the hostname
    // happens to contain it is not.
    expect(
      remoteLabel(
        status({ status: 'other-remote', remote_host: 'gitlab.acme.com', remote_forge: null })
      )
    ).toBe('gitlab.acme.com');
  });

  it('names nothing when there is no remote to name', () => {
    expect(remoteLabel(null)).toBeNull();
    expect(remoteLabel(status({ status: 'no-remote' }))).toBeNull();
    expect(remoteLabel(status({ status: 'not-a-repo' }))).toBeNull();
  });
});

describe('hasPushableRemote', () => {
  it('is true for any configured remote, GitHub or not', () => {
    expect(hasPushableRemote(status({ status: 'connected', github_repo: 'a/b' }))).toBe(true);
    expect(hasPushableRemote(status({ status: 'other-remote', remote_host: 'gitlab.com' }))).toBe(
      true
    );
  });

  it('is false when there is nowhere to push', () => {
    expect(hasPushableRemote(null)).toBe(false);
    expect(hasPushableRemote(status({ status: 'no-remote' }))).toBe(false);
    expect(hasPushableRemote(status({ status: 'not-a-repo' }))).toBe(false);
  });
});
