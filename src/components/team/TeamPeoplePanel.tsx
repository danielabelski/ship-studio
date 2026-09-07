/**
 * Who is on what.
 *
 * The closest thing to presence that can be true without a server. Nobody is
 * "online" here, and there is no green dot: what a git remote actually knows
 * is that a person has a branch, that it last moved at a time, and that it is
 * N commits ahead. That is real, it is free, and it answers the question
 * people open a team screen to ask.
 *
 * A collaborator who has pushed nothing gets a row saying exactly that. The
 * temptation is to hide them so the panel looks busy; the cost is a reader
 * concluding the person does not have access.
 *
 * @module components/team/TeamPeoplePanel
 */

import { BranchIcon, CollaboratorsIcon, PullRequestIcon } from '@/components/icons';
import { EmptyState } from '../primitives/EmptyState';
import { TeamAvatar } from './TeamAvatar';
import { formatAgo } from '../../lib/workflows';
import type { TeamMember } from '../../lib/team';

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  admin: 'Admin',
  maintainer: 'Maintainer',
  write: 'Write',
  read: 'Read',
};

interface TeamPeoplePanelProps {
  members: TeamMember[];
  now: number;
}

export function TeamPeoplePanel({ members, now }: TeamPeoplePanelProps) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={<CollaboratorsIcon size={26} />}
        title="No collaborators"
        description="This repository has no other collaborators on GitHub."
      />
    );
  }

  // Most recently active first; never-pushed last rather than interleaved by
  // a null timestamp, which would sort them as if they were ancient.
  const sorted = [...members].sort((a, b) => (b.lastPushedAt ?? -1) - (a.lastPushedAt ?? -1));

  return (
    <div className="team-people">
      <p className="team-people-note">
        Everyone with access to this repository on GitHub. Roles come from GitHub — Ship Studio has
        no accounts of its own, so there is nothing here to invite anyone to.
      </p>

      <ul className="team-people-list">
        {sorted.map((member) => (
          <li
            className={`team-person${member.isSelf ? ' is-self' : ''}`}
            key={member.actor.login ?? member.actor.name}
          >
            <TeamAvatar actor={member.actor} size="lg" isSelf={member.isSelf} />

            <div className="team-person-body">
              <div className="team-person-line">
                <span className="team-person-name">
                  {member.actor.name}
                  {member.isSelf && <span className="team-person-you">you</span>}
                </span>
                <span className="team-person-role">{ROLE_LABEL[member.role]}</span>
              </div>

              {member.actor.login ? (
                <span className="team-person-login">@{member.actor.login}</span>
              ) : (
                // A git author with no GitHub account behind it. Named by the
                // email on their commits, and said so, rather than dressed up
                // as a teammate we know something about.
                <span className="team-person-login is-unknown">Not linked to a GitHub account</span>
              )}

              {member.branch ? (
                <div className="team-person-work">
                  <span className="team-person-branch">
                    <BranchIcon size={10} />
                    {member.branch}
                  </span>
                  {member.commitsAhead > 0 && (
                    <span className="team-person-ahead">{member.commitsAhead} ahead</span>
                  )}
                  {member.prNumber !== null && (
                    <span className="team-person-pr">
                      <PullRequestIcon size={10} />#{member.prNumber}
                    </span>
                  )}
                </div>
              ) : (
                <div className="team-person-work">
                  <span className="team-person-idle">Has not pushed to this repository</span>
                </div>
              )}
            </div>

            <div className="team-person-when">
              {member.lastPushedAt !== null ? (
                <>
                  <span className="team-person-when-value">
                    {formatAgo(member.lastPushedAt, now)}
                  </span>
                  <span className="team-person-when-label">last pushed</span>
                </>
              ) : (
                <span className="team-person-when-label">—</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* The honest caveat, said once, where the misreading would happen. */}
      <p className="team-people-footnote">
        “Last pushed” is the only activity a git remote can report. Uncommitted work, and work that
        has not been pushed, is invisible to everyone — including to this panel.
      </p>
    </div>
  );
}
