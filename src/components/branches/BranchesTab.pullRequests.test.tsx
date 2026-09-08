/**
 * "Submit for Review" must not appear for a project whose remote isn't GitHub.
 *
 * Everything else on this tab is plain git and works against any forge, but
 * that button ends in `gh pr create` against a repo GitHub has never heard of.
 * The tab used to be unreachable for those projects, which hid the problem;
 * now that a GitLab project can open it, the action has to be gated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BranchesTab } from './BranchesTab';
import { ToastContext } from '../../contexts/ToastContext';
import type { BranchInfo } from '../../lib/branches';

vi.mock('../../lib/branches', () => ({
  switchBranch: vi.fn(),
  deleteBranch: vi.fn(),
  createBranch: vi.fn(),
  discardChanges: vi.fn().mockResolvedValue(undefined),
  formatRelativeTime: vi.fn(() => 'just now'),
  getBranchPrefixPreference: vi.fn().mockResolvedValue(true),
  setBranchPrefixPreference: vi.fn().mockResolvedValue(undefined),
  getDefaultBaseBranch: vi.fn().mockResolvedValue(null),
  pushBranch: vi.fn(),
  sanitizeBranchName: vi.fn((s: string) => s),
}));
vi.mock('../../lib/git', () => ({ gitPull: vi.fn() }));
vi.mock('../../lib/worktrees', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
}));
vi.mock('../../lib/project', () => ({ openProjectInNewWindow: vi.fn() }));
vi.mock('../../lib/conflicts', () => ({ getConflictInfo: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ trackEvent: vi.fn(), trackError: vi.fn() }));
vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('./BranchGraph', () => ({ BranchGraph: () => null }));
vi.mock('./UnsavedChangesModal', () => ({ UnsavedChangesModal: () => null }));
vi.mock('./MergeConflictModal', () => ({ MergeConflictModal: () => null }));
vi.mock('./CreateBranchConflictModal', () => ({ CreateBranchConflictModal: () => null }));

import {
  formatRelativeTime,
  getBranchPrefixPreference,
  getDefaultBaseBranch,
  sanitizeBranchName,
} from '../../lib/branches';
import { listWorktrees } from '../../lib/worktrees';

const featureBranch: BranchInfo = {
  name: 'feat/pricing',
  isCurrent: true,
  isRemote: false,
  isDefault: false,
  lastCommitDate: Date.now(),
  lastCommitAuthor: 'Test',
  aheadOfMain: 1,
  behindOfMain: 0,
  pushed: true,
};

function renderTab(ui: ReactNode) {
  render(
    <ToastContext.Provider value={{ toasts: [], showToast: vi.fn(), dismissToast: vi.fn() }}>
      {ui}
    </ToastContext.Provider>
  );
}

describe('BranchesTab — pull requests need a GitHub remote', () => {
  const props = {
    branches: [featureBranch],
    currentBranch: 'feat/pricing',
    projectPath: '/test/project',
    githubUsername: null,
    openPRs: [],
    onBranchSwitch: vi.fn(),
    onSubmitForReview: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBranchPrefixPreference).mockResolvedValue(true);
    vi.mocked(getDefaultBaseBranch).mockResolvedValue(null);
    vi.mocked(formatRelativeTime).mockReturnValue('just now');
    vi.mocked(sanitizeBranchName).mockImplementation((s: string) => s);
    vi.mocked(listWorktrees).mockResolvedValue([]);
  });

  it('offers Submit for Review on a GitHub project', async () => {
    renderTab(<BranchesTab {...props} canOpenPullRequests />);

    expect(await screen.findByRole('button', { name: /submit for review/i })).toBeTruthy();
  });

  it('hides it when the remote is not GitHub', async () => {
    renderTab(<BranchesTab {...props} canOpenPullRequests={false} />);

    // The branch itself is still listed — only the PR action is gone.
    expect(await screen.findByText(/feat\/pricing/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /submit for review/i })).toBeNull();
  });

  it('defaults to offering it, so existing callers are unchanged', async () => {
    renderTab(<BranchesTab {...props} />);

    expect(await screen.findByRole('button', { name: /submit for review/i })).toBeTruthy();
  });
});
