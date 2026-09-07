/**
 * Who else is in this repo, in the workspace header.
 *
 * The smallest thing that makes a project stop feeling like a room you are
 * alone in. Faces, ordered by who moved most recently, with a count of what
 * has landed since you last looked.
 *
 * It is not presence and does not pretend to be: no green dots, no "active
 * now". Every avatar here is someone with a branch that has actually moved,
 * which is the only thing a git remote can tell us and — usefully — the thing
 * people are really asking when they ask who is around.
 *
 * @module components/team/TeamPresence
 */

import { CollaboratorsIcon } from '@/components/icons';
import { TeamAvatar } from './TeamAvatar';
import { formatAgo } from '../../lib/workflows';
import { activeTeammates, actorKey, type TeamMember } from '../../lib/team';

/** Beyond this the rest collapse into a "+N". Four is what the header fits. */
const MAX_FACES = 4;

interface TeamPresenceProps {
  members: TeamMember[];
  /** Updates that have arrived since the user last looked. */
  unseenCount: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
  now: number;
}

export function TeamPresence({
  members,
  unseenCount,
  panelOpen,
  onTogglePanel,
  now,
}: TeamPresenceProps) {
  const teammates = activeTeammates(members);
  if (teammates.length === 0) return null;

  const shown = teammates.slice(0, MAX_FACES);
  const overflow = teammates.length - shown.length;

  const summary = teammates
    .map(
      (member) =>
        `${member.actor.name} — ${member.branch ?? 'no branch'}, ${
          member.lastPushedAt ? formatAgo(member.lastPushedAt, now) : 'never pushed'
        }`
    )
    .join('\n');

  return (
    <button
      type="button"
      className={`team-presence${panelOpen ? ' is-open' : ''}`}
      onClick={onTogglePanel}
      aria-pressed={panelOpen}
      title={summary}
      aria-label={
        unseenCount > 0
          ? `Team — ${teammates.length} others, ${unseenCount} new`
          : `Team — ${teammates.length} others`
      }
    >
      <CollaboratorsIcon size={13} />
      <span className="team-presence-faces">
        {shown.map((member) => (
          <TeamAvatar key={actorKey(member.actor)} actor={member.actor} size="sm" />
        ))}
        {overflow > 0 && (
          <span className="team-avatar team-avatar--sm team-avatar--overflow">
            <span className="team-avatar-initials" aria-hidden>
              +{overflow}
            </span>
          </span>
        )}
      </span>
      {unseenCount > 0 && (
        <span className="team-presence-badge" aria-hidden>
          {unseenCount > 9 ? '9+' : unseenCount}
        </span>
      )}
    </button>
  );
}
