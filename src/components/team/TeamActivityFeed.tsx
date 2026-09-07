/**
 * The activity feed: what everyone has been doing, newest first.
 *
 * Grouped by day rather than shown as one flat river, because the question
 * people bring to this screen is "what happened while I was away" and a day is
 * the unit they think in.
 *
 * Filtering is by category and by person, both of which are answerable from
 * the events themselves. There is deliberately no date-range picker — the log
 * is a stream you scroll, and a range control implies a completeness this data
 * does not have (a teammate who never opened Ship Studio contributes only what
 * git knows about them).
 *
 * @module components/team/TeamActivityFeed
 */

import { useMemo, useState } from 'react';
import { ChevronIcon, HistoryIcon, SearchIcon } from '@/components/icons';
import { Dropdown, DropdownItem } from '../primitives/Dropdown';
import { EmptyState } from '../primitives/EmptyState';
import { MenuButton } from '../primitives/MenuButton';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { TeamActivityRow } from './TeamActivityRow';
import {
  groupByDay,
  TEAM_CATEGORY_LABEL,
  TEAM_EVENT_CATEGORY,
  type TeamCategory,
  type TeamEvent,
} from '../../lib/team';

type CategoryFilter = TeamCategory | 'all';

interface TeamActivityFeedProps {
  events: TeamEvent[];
  /** Null means "every project", which hides the per-row project chip. */
  projectFilter: string | null;
  now: number;
}

export function TeamActivityFeed({ events, projectFilter, now }: TeamActivityFeedProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [person, setPerson] = useState<string>('all');
  const [query, setQuery] = useState('');

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of events) seen.set(event.actor.login ?? event.actor.name, event.actor.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (category !== 'all' && TEAM_EVENT_CATEGORY[event.kind] !== category) return false;
      if (person !== 'all' && (event.actor.login ?? event.actor.name) !== person) return false;
      if (!needle) return true;
      // Search what is on screen — the sentence, the detail, the refs — rather
      // than the event kind, which nobody can see and nobody would type.
      const haystack = [
        event.actor.name,
        event.summary,
        event.detail ?? '',
        event.branch ?? '',
        event.projectName,
        ...event.refs.map((ref) => ref.label),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [events, category, person, query]);

  const groups = useMemo(() => groupByDay(visible, now), [visible, now]);

  return (
    <div className="team-feed">
      <div className="team-feed-controls">
        <label className="team-search">
          <SearchIcon size={12} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activity"
            aria-label="Search activity"
          />
        </label>

        <div className="team-feed-filters">
          <SegmentedControl
            aria-label="Filter by area"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: 'all', label: 'All' },
              ...(Object.keys(TEAM_CATEGORY_LABEL) as TeamCategory[]).map((key) => ({
                value: key,
                label: TEAM_CATEGORY_LABEL[key],
              })),
            ]}
          />
          <Dropdown
            trigger={(props) => (
              <MenuButton
                variant="secondary"
                size="compact"
                expanded={props['aria-expanded']}
                {...props}
              >
                {person === 'all'
                  ? 'Everyone'
                  : (people.find(([key]) => key === person)?.[1] ?? person)}
                <ChevronIcon
                  size={10}
                  className={props['aria-expanded'] ? 'chevron-flipped' : undefined}
                />
              </MenuButton>
            )}
          >
            <DropdownItem active={person === 'all'} onSelect={() => setPerson('all')}>
              Everyone
            </DropdownItem>
            {people.map(([key, name]) => (
              <DropdownItem key={key} active={person === key} onSelect={() => setPerson(key)}>
                {name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon size={26} />}
          title="Nothing matches"
          description="No activity matches these filters. Clear them to see the whole log."
        />
      ) : (
        <div className="team-feed-scroll">
          {groups.map((group) => (
            <section className="team-day" key={group.key}>
              <h3 className="team-day-heading">{group.label}</h3>
              <ul className="team-day-events">
                {group.events.map((event) => (
                  <TeamActivityRow
                    key={event.id}
                    event={event}
                    showProject={projectFilter === null}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/* The log is only as complete as the repo. Saying so at the end of
              it is cheaper than someone inferring that a quiet teammate did
              nothing, when in truth they never pushed. */}
          <p className="team-feed-footnote">
            This log is built from your repository. Work that was never pushed — and teammates who
            do not use Ship Studio — appear here only through their commits.
          </p>
        </div>
      )}
    </div>
  );
}
