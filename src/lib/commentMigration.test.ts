import { beforeEach, expect, it, vi } from 'vitest';

/** Comments written, in the order the migration wrote them. */
let written: { body: string; branch: string | null; pin: number; route: string }[] = [];
let failOn: string | null = null;

vi.mock('./teamApi', () => ({
  addTeamComment: (input: { body: string; branch: string | null; pin: number; route: string }) => {
    if (failOn === input.body) return Promise.reject(new Error('Disk unavailable'));
    written.push(input);
    return Promise.resolve(`t-${written.length}`);
  },
}));

const { findLegacyNotes, migrateLegacyComments } = await import('./commentMigration');

const target = {
  page: '/pricing',
  selector: '#hero h1',
  tag: 'h1',
  text: 'Simple pricing',
  heading: 'Simple pricing',
  classes: 'title',
  ancestors: ['main', 'section'],
  viewport: { width: 1440, height: 900 },
  rect: { x: 0, y: 0, width: 400, height: 48 },
};

function saveLegacy(project: string, branch: string, id: string, body: string, createdAt: string) {
  const key = `shipstudio.canvas-comments.v1:${encodeURIComponent(project)}:${encodeURIComponent(branch)}:${id}`;
  localStorage.setItem(
    key,
    JSON.stringify({ id, number: 1, target, body, status: 'pending', createdAt })
  );
}

beforeEach(() => {
  localStorage.clear();
  written = [];
  failOn = null;
});

it('finds notes across every branch the project had them on', () => {
  saveLegacy('/site', 'main', 'a', 'on main', '2026-09-01');
  saveLegacy('/site', 'feat/pricing', 'b', 'on a branch', '2026-09-02');
  saveLegacy('/other', 'main', 'c', 'different project', '2026-09-03');

  const found = findLegacyNotes('/site');
  expect(found.map((note) => note.comment.body)).toEqual(['on main', 'on a branch']);
  expect(found.map((note) => note.branch)).toEqual(['main', 'feat/pricing']);
});

it('keeps the branch each note was written on', async () => {
  saveLegacy('/site', 'feat/pricing-tiers', 'a', 'note', '2026-09-01');
  await migrateLegacyComments('/site');
  expect(written[0].branch).toBe('feat/pricing-tiers');
});

it('moves notes oldest first, so their pin order matches what the person saw', async () => {
  saveLegacy('/site', 'main', 'c', 'third', '2026-09-03');
  saveLegacy('/site', 'main', 'a', 'first', '2026-09-01');
  saveLegacy('/site', 'main', 'b', 'second', '2026-09-02');

  expect(await migrateLegacyComments('/site')).toBe(3);
  expect(written.map((w) => w.body)).toEqual(['first', 'second', 'third']);
});

it('never runs twice for the same project', async () => {
  saveLegacy('/site', 'main', 'a', 'note', '2026-09-01');
  expect(await migrateLegacyComments('/site')).toBe(1);
  expect(await migrateLegacyComments('/site')).toBe(0);
  expect(written).toHaveLength(1);
});

it('leaves the originals in place, so nothing is lost if this goes wrong', async () => {
  saveLegacy('/site', 'main', 'a', 'note', '2026-09-01');
  await migrateLegacyComments('/site');

  const keys = Object.keys(localStorage).filter((key) =>
    key.startsWith('shipstudio.canvas-comments.v1:')
  );
  expect(keys).toHaveLength(1);
});

it('rescues the rest when one note will not write', async () => {
  saveLegacy('/site', 'main', 'a', 'good one', '2026-09-01');
  saveLegacy('/site', 'main', 'b', 'bad one', '2026-09-02');
  saveLegacy('/site', 'main', 'c', 'another good one', '2026-09-03');
  failOn = 'bad one';

  expect(await migrateLegacyComments('/site')).toBe(2);
  expect(written.map((w) => w.body)).toEqual(['good one', 'another good one']);
});

it('skips a corrupt entry instead of failing the whole migration', async () => {
  localStorage.setItem('shipstudio.canvas-comments.v1:%2Fsite:main:broken', '{ not json at all');
  saveLegacy('/site', 'main', 'a', 'fine', '2026-09-01');

  expect(await migrateLegacyComments('/site')).toBe(1);
  expect(written.map((w) => w.body)).toEqual(['fine']);
});

it('does nothing, quietly, for someone who never used the old feature', async () => {
  expect(await migrateLegacyComments('/site')).toBe(0);
  expect(written).toHaveLength(0);
});
