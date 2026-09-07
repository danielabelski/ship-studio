/**
 * What everyone has been doing, newest first.
 *
 * Grouped by day rather than shown as one flat river, because the question
 * people bring here is "what happened while I was away" and a day is the unit
 * they think in.
 *
 * Filters are by person and by whether a row wants something from you. There
 * is deliberately no filter by event type — that was the first version's idea
 * and it was a symptom of the wrong model: once a row is a piece of work
 * rather than a git event, "show me only the pushes" stops being a question
 * anyone has.
 *
 * @module components/team/TeamUpdatesFeed
 */

import { useMemo, useState } from 'react';
import { ChevronIcon, HistoryIcon, SearchIcon } from '@/components/icons';
import { Dropdown, DropdownItem } from '../primitives/Dropdown';
import { EmptyState } from '../primitives/EmptyState';
import { MenuButton } from '../primitives/MenuButton';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { Spinner } from '../primitives/Spinner';
import { TeamCoverageNote } from './TeamCoverageNote';
import { TeamUpdateCard } from './TeamUpdateCard';
import { actorKey, groupByDay, type TeamMember, type TeamUpdate } from '../../lib/team';

type Scope = 'all' | 'asks' | 'rich';

interface TeamUpdatesFeedProps {
  updates: TeamUpdate[];
  members: TeamMember[];
  /** `owner/repo`, so the invite text names the actual project. */
  repo: string | null;
  unseenIds: Set<string>;
  expandedId: string | null;
  onToggleExpanded: (id: string) => void;
  /** Reading the repo. Distinguishes "nothing yet" from "not looked yet". */
  loading?: boolean;
  /** What went wrong reading it, if anything. Shown, never swallowed. */
  error?: string | null;
  now: number;
}

export function TeamUpdatesFeed({
  updates,
  members,
  repo,
  unseenIds,
  expandedId,
  onToggleExpanded,
  loading = false,
  error = null,
  now,
}: TeamUpdatesFeedProps) {
  const [scope, setScope] = useState<Scope>('all');
  const [person, setPerson] = useState<string>('all');
  const [query, setQuery] = useState('');

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const update of updates) seen.set(actorKey(update.actor), update.actor.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [updates]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return updates.filter((update) => {
      if (scope === 'asks' && !update.asks) return false;
      if (scope === 'rich' && update.writtenBy === 'app') return false;
      if (person !== 'all' && actorKey(update.actor) !== person) return false;
      if (!needle) return true;
      // Search what is on the card — the sentence, the reasoning, the files —
      // rather than the status enum, which nobody can see and nobody types.
      const haystack = [
        update.actor.name,
        update.headline,
        update.why ?? '',
        update.asks ?? '',
        update.branch,
        ...update.changes,
        ...update.files.map((file) => file.path),
        ...update.commits.map((commit) => commit.message),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [updates, scope, person, query]);

  const groups = useMemo(() => groupByDay(visible, now), [visible, now]);
  const filtered = scope !== 'all' || person !== 'all' || query.trim() !== '';

  return (
    <div className="team-feed">
      <div className="team-feed-controls">
        <label className="team-search">
          <SearchIcon size={12} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what people did"
            aria-label="Search updates"
          />
        </label>

        <div className="team-feed-filters">
          <SegmentedControl
            aria-label="Filter updates"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'asks', label: 'Wants a look' },
              { value: 'rich', label: 'Explained' },
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

      {/* Four different nothings, and telling them apart is the whole job.
          "No updates match these filters" on an unfiltered feed reads as a
          broken feature; "nobody has done anything" on a repo we failed to read
          is a lie about your teammates. */}
      {groups.length === 0 ? (
        loading ? (
          <EmptyState
            icon={<Spinner size="lg" />}
            title="Reading your repository"
            description="Walking the history and asking GitHub about open pull requests."
          />
        ) : error ? (
          <EmptyState
            icon={<HistoryIcon size={26} />}
            title="Couldn't read the history"
            description={error}
          />
        ) : filtered ? (
          <EmptyState
            icon={<HistoryIcon size={26} />}
            title="Nothing matches"
            description="No updates match these filters. Clear them to see everything."
          />
        ) : (
          <EmptyState
            icon={<HistoryIcon size={26} />}
            title="Nothing here yet"
            description={
              repo
                ? `Nothing has been committed to ${repo} in the last month. Anything you or your teammates push shows up here, from Ship Studio, from a terminal, from anywhere.`
                : 'This project has no GitHub remote, so there is nobody to share with yet. Your own commits will still show up here.'
            }
          />
        )
      ) : (
        <div className="team-feed-scroll">
          {groups.map((group) => (
            <section className="team-day" key={group.key}>
              <h3 className="team-day-heading">{group.label}</h3>
              {group.updates.map((update) => (
                <TeamUpdateCard
                  key={update.id}
                  update={update}
                  expanded={expandedId === update.id}
                  onToggleExpanded={onToggleExpanded}
                  isNew={unseenIds.has(update.id)}
                  now={now}
                />
              ))}
            </section>
          ))}

          {/* The log is only as complete as the repo. Saying so at the end of
              it is cheaper than someone inferring that a quiet teammate did
              nothing, when in truth they never pushed. */}
          <TeamCoverageNote members={members} repo={repo} />

          <p className="team-feed-footnote">
            Built from your repository. Work nobody pushed appears nowhere at all. A git remote
            cannot see a file that has not left someone&rsquo;s laptop.
          </p>
        </div>
      )}
    </div>
  );
}
