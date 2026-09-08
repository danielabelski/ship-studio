#!/usr/bin/env node
/**
 * What a running trial has got to, read off disk.
 *
 * `claude --print` buffers its whole reply until it exits, so the log says
 * nothing while a migration is in progress. The files it writes as it goes say
 * plenty, and they are the same files the panel reads — which makes this both
 * the progress view and a check that the agent is keeping them current.
 *
 * Usage: node prototypes/site-migration/trial-status.mjs <project-dir>
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: trial-status.mjs <project-dir>');
  process.exit(2);
}

/**
 * Every comparison under `dir`, however deeply it was nested.
 *
 * A run is a directory holding a `report.json`, and where that sits is the
 * agent's choice: batching pages under one `--out` produces
 * `<batch>/<page>/report.json`. Listing only the top level showed a batch as
 * one "pending" entry and hid every measurement inside it.
 */
async function findRuns(dir, root = dir, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const child = path.join(dir, e.name);
    try {
      const report = JSON.parse(await readFile(path.join(child, 'report.json'), 'utf8'));
      found.push({ name: path.relative(root, child), report });
    } catch {
      found.push(...(await findRuns(child, root, depth + 1)));
    }
  }
  return found;
}

const since = (t) => `${Math.round((Date.now() - new Date(t).getTime()) / 60000)}m ago`;

try {
  const status = JSON.parse(await readFile(path.join(root, '.shipstudio/migration.json'), 'utf8'));
  console.log(`source   ${status.sourceUrl}   (started ${since(status.startedAt)})`);
  console.log('');
  for (const p of status.phases ?? []) {
    console.log(`  ${String(p.status).padEnd(13)} ${String(p.label).padEnd(15)} ${(p.detail ?? '').slice(0, 74)}`);
  }
  console.log('');
  console.log(`  doing      ${(status.doing ?? '—').slice(0, 90)}`);
  console.log(
    `  done ${(status.done ?? []).length}   not done ${(status.notDone ?? []).length}   can't carry ${(status.cannotCarry ?? []).length}   needs you ${(status.needsYou ?? []).length}`
  );
} catch (err) {
  console.log(`no readable status: ${err.message}`);
}

const fidelity = path.join(root, '.shipstudio/fidelity');
const found = await findRuns(fidelity);
console.log('');
if (found.length === 0) {
  console.log('fidelity runs   none yet');
} else {
  console.log(`fidelity runs (${found.length})`);
  for (const { name, report } of found.sort((a, b) => a.name.localeCompare(b.name))) {
    const widths = (report.breakpoints ?? [])
      .map((b) => `${b.breakpoint}:${b.score}`)
      .join('  ');
    const partial = report.complete === false ? '  [partial]' : '';
    console.log(`  ${name.padEnd(34)} ${String(report.score).padStart(6)}%  ${widths}${partial}`);
  }
}

for (const file of ['MIGRATION.md']) {
  try {
    const s = await stat(path.join(root, file));
    console.log(`\n${file}   ${s.size} bytes, touched ${since(s.mtime)}`);
  } catch {
    console.log(`\n${file}   not written`);
  }
}
