import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamSelfCoverageNote } from './TeamSelfCoverageNote';
import type { TeamUpdate } from '../../lib/team';

vi.mock('../../contexts/ToastContext', () => ({
  useOptionalToast: () => ({ showToast: vi.fn() }),
}));

const installCommitGuidance = vi.fn((_path: string) => Promise.resolve('/site/CLAUDE.md'));
vi.mock('../../lib/teamApi', () => ({
  installCommitGuidance: (path: string) => installCommitGuidance(path),
}));

const me = { login: 'julian', name: 'Julian Galluzzo', avatarUrl: null };
const someoneElse = { login: 'mayareed', name: 'Maya Reed', avatarUrl: null };

function update(id: string, writtenBy: TeamUpdate['writtenBy'], actor = me): TeamUpdate {
  return {
    id,
    at: Date.now(),
    actor,
    writtenBy,
    agentName: writtenBy === 'agent' ? 'Claude Code' : null,
    headline: 'did a thing',
    why: null,
    changes: [],
    asks: null,
    branch: 'main',
    status: 'working',
    projectName: 'site',
    projectPath: '/site',
    commits: [],
    files: [],
    prNumber: null,
    buildError: null,
    githubUrl: null,
  };
}

it('says nothing when the summaries are being written', () => {
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'agent'), update('b', 'agent'), update('c', 'agent')]}
      me={me}
      projectPath="/site"
      installed={false}
      onInstalled={() => {}}
    />
  );
  expect(screen.queryByText(/not writing summaries/)).not.toBeInTheDocument();
});

it('says nothing about one hand-made commit among several good rows', () => {
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'agent'), update('b', 'agent'), update('c', 'app')]}
      me={me}
      projectPath="/site"
      installed={false}
      onInstalled={() => {}}
    />
  );
  expect(screen.queryByText(/not writing summaries/)).not.toBeInTheDocument();
});

it('explains itself once several of your own pushes come back with no summary', () => {
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'app'), update('b', 'app'), update('c', 'app')]}
      me={me}
      projectPath="/site"
      installed={false}
      onInstalled={() => {}}
    />
  );
  expect(screen.getByText(/not writing summaries/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Add it to the instructions/ })).toBeInTheDocument();
});

it('writes the block into the project and tells the panel to re-read', async () => {
  const onInstalled = vi.fn();
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'app'), update('b', 'app'), update('c', 'app')]}
      me={me}
      projectPath="/site"
      installed={false}
      onInstalled={onInstalled}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: /Add it to the instructions/ }));
  expect(installCommitGuidance).toHaveBeenCalledWith('/site');
  // The note disappears on the next snapshot, not by hiding itself here — the
  // file on disk is the only thing that decides whether it is still needed.
  expect(onInstalled).toHaveBeenCalled();
});

it('stops offering the fix once the project already carries it', () => {
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'app'), update('b', 'app'), update('c', 'app')]}
      me={me}
      projectPath="/site"
      installed
      onInstalled={() => {}}
    />
  );
  // Thin rows with the advice already taken is not a problem the app can do
  // anything more about, and repeating it would be a nag.
  expect(screen.queryByText(/not writing summaries/)).not.toBeInTheDocument();
});

it('is about your own rows, not a teammate who uses a different tool', () => {
  render(
    <TeamSelfCoverageNote
      updates={[
        update('a', 'app', someoneElse),
        update('b', 'app', someoneElse),
        update('c', 'app', someoneElse),
      ]}
      me={me}
      projectPath="/site"
      installed={false}
      onInstalled={() => {}}
    />
  );
  // That case is the teammate-coverage note's, and saying it twice would read
  // as a complaint about them.
  expect(screen.queryByText(/not writing summaries/)).not.toBeInTheDocument();
});

it('says nothing when nobody is identified, rather than guessing whose rows these are', () => {
  render(
    <TeamSelfCoverageNote
      updates={[update('a', 'app'), update('b', 'app'), update('c', 'app')]}
      me={null}
      projectPath="/site"
      installed={false}
      onInstalled={() => {}}
    />
  );
  expect(screen.queryByText(/not writing summaries/)).not.toBeInTheDocument();
});
