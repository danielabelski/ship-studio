/**
 * One line of team activity.
 *
 * The layout is the one every activity log converges on — actor, sentence,
 * badge, age — with one addition Ship Studio needs and most do not: a marker
 * saying whether the row came from git history or from a teammate's app.
 *
 * That marker is not decoration. Without a server there is nothing to
 * authenticate a write, so half of this feed is verifiable (git wrote it) and
 * half is self-reported (an app appended it, and anyone who can push could
 * have appended it). A log that renders both identically is claiming an
 * assurance it does not have, and this app does not display data it cannot
 * stand behind. The git rows get the marker; the rest simply go without.
 *
 * @module components/team/TeamActivityRow
 */

import {
  ActivityIcon,
  BellIcon,
  BranchIcon,
  CheckIcon,
  CommentIcon,
  ErrorIcon,
  HistoryIcon,
  PullRequestIcon,
  PushIcon,
  ShieldCheckIcon,
  SuccessIcon,
  TerminalIcon,
} from '@/components/icons';
import { TeamAvatar } from './TeamAvatar';
import { formatAgo } from '../../lib/workflows';
import {
  TEAM_CATEGORY_LABEL,
  TEAM_EVENT_CATEGORY,
  type TeamEvent,
  type TeamEventKind,
} from '../../lib/team';

const KIND_ICON: Record<TeamEventKind, typeof PushIcon> = {
  'commit.pushed': PushIcon,
  'branch.created': BranchIcon,
  'pr.opened': PullRequestIcon,
  'pr.merged': PullRequestIcon,
  'comment.added': CommentIcon,
  'comment.resolved': CommentIcon,
  'workflow.ran': ActivityIcon,
  'agent.session': TerminalIcon,
  'finding.filed': BellIcon,
  'finding.fixed': CheckIcon,
  'deploy.succeeded': SuccessIcon,
  'deploy.failed': ErrorIcon,
  'snapshot.restored': HistoryIcon,
};

interface TeamActivityRowProps {
  event: TeamEvent;
  /** Hidden when the feed is already filtered to one project. */
  showProject: boolean;
  now: number;
}

export function TeamActivityRow({ event, showProject, now }: TeamActivityRowProps) {
  const category = TEAM_EVENT_CATEGORY[event.kind];
  const KindIcon = KIND_ICON[event.kind];

  return (
    <li className="team-event" data-category={category}>
      <span className="team-event-figure">
        <TeamAvatar actor={event.actor} size="md" />
        <span className="team-event-kind" data-category={category} aria-hidden>
          <KindIcon size={9} />
        </span>
      </span>

      <span className="team-event-body">
        <span className="team-event-line">
          <span className="team-event-sentence">
            <span className="team-event-actor">{event.actor.name}</span> {event.summary}
          </span>
          <span className="team-event-age">{formatAgo(event.at, now)}</span>
        </span>

        {event.detail && <span className="team-event-detail">{event.detail}</span>}

        <span className="team-event-meta">
          <span className="team-badge" data-category={category}>
            {TEAM_CATEGORY_LABEL[category]}
          </span>
          {showProject && <span className="team-chip">{event.projectName}</span>}
          {event.refs.map((ref) => (
            <span key={`${ref.kind}-${ref.label}`} className="team-event-ref" data-kind={ref.kind}>
              {ref.label}
            </span>
          ))}
          {event.source === 'git' && (
            <span
              className="team-event-source"
              title="Reconstructed from git history. Verifiable against the repository."
            >
              <ShieldCheckIcon size={10} />
              from git
            </span>
          )}
        </span>
      </span>
    </li>
  );
}
