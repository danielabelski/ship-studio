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

  let runs = [];
  try {
    for (const e of await readdir(path.join(root, '.shipstudio/fidelity'), {
      withFileTypes: true,
    })) {
      if (!e.isDirectory()) continue;
      // A run is a directory the capture tool wrote; anything else living
      // beside them is not one.
      if (e.name.startsWith('.')) continue;
      try {
        const r = JSON.parse(
          await readFile(path.join(root, '.shipstudio/fidelity', e.name, 'report.json'), 'utf8')
        );
        runs.push(`${e.name}:${r.score}%`);
      } catch {
        runs.push(`${e.name}:pending`);
      }
    }
  } catch {
    /* none yet */
  }

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
