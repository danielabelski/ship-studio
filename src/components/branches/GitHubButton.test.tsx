/**
 * Tests for GitHubButton's handling of remotes that aren't GitHub.
 *
 * The contract: a project whose code lives elsewhere is never pushed toward
 * GitHub — not to create a repo it already has, and not to install or sign in
 * to a CLI it has no use for.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitHubButton } from './GitHubButton';
import type { ProjectGitHubStatus } from '../../lib/github';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

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

function makeProps(overrides?: Partial<Parameters<typeof GitHubButton>[0]>) {
  return {
    githubState: {
      cliStatus: { installed: true, authenticated: true },
      username: 'someone',
    } as Parameters<typeof GitHubButton>[0]['githubState'],
    projectStatus: null,
    projectPath: '/test/path',
    projectName: 'acme',
    onStatusChange: vi.fn(),
    onGitHubConnect: vi.fn(),
    ...overrides,
  };
}

describe('GitHubButton with a non-GitHub remote', () => {
  const gitlab = status({
    status: 'other-remote',
    remote_host: 'gitlab.com',
    remote_forge: 'GitLab',
  });

  it('names the forge instead of offering to create a repo', () => {
    render(<GitHubButton {...makeProps({ projectStatus: gitlab })} />);

    expect(screen.getByText('GitLab')).toBeInTheDocument();
    expect(screen.queryByText('Create Repo')).not.toBeInTheDocument();
  });

  it('shows the bare host when the forge is unknown', () => {
    const selfManaged = status({
      status: 'other-remote',
      remote_host: 'git.acme.com',
      remote_forge: null,
    });

    render(<GitHubButton {...makeProps({ projectStatus: selfManaged })} />);

    expect(screen.getByText('git.acme.com')).toBeInTheDocument();
  });

  it('does not tell a GitLab project to install the GitHub CLI', () => {
    // The remote is the answer regardless of gh's state — this check has to
    // come before the install/connect prompts, not after them.
    render(
      <GitHubButton
        {...makeProps({
          projectStatus: gitlab,
          githubState: {
            cliStatus: { installed: false, authenticated: false },
            username: null,
          } as Parameters<typeof GitHubButton>[0]['githubState'],
        })}
      />
    );

    expect(screen.queryByText('Install CLI')).not.toBeInTheDocument();
    expect(screen.getByText('GitLab')).toBeInTheDocument();
  });

  it('does not tell a GitLab project to connect a GitHub account', () => {
    render(
      <GitHubButton
        {...makeProps({
          projectStatus: gitlab,
          githubState: {
            cliStatus: { installed: true, authenticated: false },
            username: null,
          } as Parameters<typeof GitHubButton>[0]['githubState'],
        })}
      />
    );

    expect(screen.queryByText('Connect')).not.toBeInTheDocument();
    expect(screen.getByText('GitLab')).toBeInTheDocument();
  });

  it('still offers to create a repo when there is genuinely no remote', () => {
    render(<GitHubButton {...makeProps({ projectStatus: status({ status: 'no-remote' }) })} />);

    expect(screen.getByText('Create Repo')).toBeInTheDocument();
  });
});
