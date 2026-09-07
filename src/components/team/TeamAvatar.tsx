/**
 * A person, drawn small.
 *
 * Falls back to initials on a stable per-person colour rather than to a
 * silhouette, because a page of identical grey heads is unreadable at the size
 * these are used. The colour is hashed from the GitHub login so one person
 * keeps one colour on every screen — including across a reload, which a colour
 * assigned by list position would not.
 *
 * No image is ever guessed. `avatarUrl` comes from the GitHub API or it is
 * null, and null renders initials.
 *
 * @module components/team/TeamAvatar
 */

import { actorSwatch, initialsOf, type TeamActor } from '../../lib/team';

/** Matches the `--color-swatch-*` set the stylesheet cycles through. */
const SWATCHES = 8;

type AvatarSize = 'sm' | 'md' | 'lg';

interface TeamAvatarProps {
  actor: TeamActor;
  size?: AvatarSize;
  /** Adds a ring, for the signed-in user in a list of teammates. */
  isSelf?: boolean;
}

export function TeamAvatar({ actor, size = 'md', isSelf = false }: TeamAvatarProps) {
  const label = actor.login ? `${actor.name} (@${actor.login})` : actor.name;
  return (
    <span
      className={`team-avatar team-avatar--${size}${isSelf ? ' is-self' : ''}`}
      data-swatch={actorSwatch(actor, SWATCHES)}
      title={label}
      role="img"
      aria-label={label}
    >
      {actor.avatarUrl ? (
        <img className="team-avatar-image" src={actor.avatarUrl} alt="" />
      ) : (
        <span className="team-avatar-initials" aria-hidden>
          {initialsOf(actor)}
        </span>
      )}
    </span>
  );
}

interface TeamAvatarStackProps {
  actors: TeamActor[];
  size?: AvatarSize;
  /** Beyond this, the rest collapse into a "+N". */
  max?: number;
}

/** Overlapping avatars for "who is in this conversation". */
export function TeamAvatarStack({ actors, size = 'sm', max = 3 }: TeamAvatarStackProps) {
  const shown = actors.slice(0, max);
  const overflow = actors.length - shown.length;
  return (
    <span className="team-avatar-stack">
      {shown.map((actor) => (
        <TeamAvatar key={actor.login ?? actor.name} actor={actor} size={size} />
      ))}
      {overflow > 0 && (
        <span
          className={`team-avatar team-avatar--${size} team-avatar--overflow`}
          title={actors
            .slice(max)
            .map((actor) => actor.name)
            .join(', ')}
        >
          <span className="team-avatar-initials" aria-hidden>
            +{overflow}
          </span>
        </span>
      )}
    </span>
  );
}
