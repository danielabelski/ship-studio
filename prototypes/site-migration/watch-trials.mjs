#!/usr/bin/env node
/**
 * Emit a line whenever a trial changes phase or produces a comparison.
 *
 * Polling the status files rather than the agent's output, for the same reason
 * `trial-status.mjs` does: `claude --print` says nothing until it exits. This
 * prints only on change, so a long survey is silent and a phase transition is
 * not missed.
 *
 * Usage: node prototypes/site-migration/watch-trials.mjs <dir> [<dir> …]
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: watch-trials.mjs <project-dir> [<project-dir> …]');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = new Map();

async function snapshot(root) {
  let phases = 'unreadable';
  let doing = '';
  try {
    const s = JSON.parse(await readFile(path.join(root, '.shipstudio/migration.json'), 'utf8'));
    phases = (s.phases ?? []).map((p) => `${p.id}=${p.status}`).join(' ');
    doing = (s.doing ?? '').slice(0, 70);
  } catch {
    /* not written yet */
  }

  const found = await findRuns(path.join(root, '.shipstudio/fidelity'));
  const runs = found
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, report }) => `${name}:${report.score}%`);

  return `${phases} | runs ${runs.join(' ') || 'none'} | ${doing}`;
}

for (let i = 0; i < 300; i += 1) {
  for (const root of roots) {
    const name = path.basename(root);
    const now = await snapshot(root);
    if (seen.get(name) !== now) {
      seen.set(name, now);
      console.log(`${name}  ${now}`);
    }
  }
  await sleep(20000);
}
