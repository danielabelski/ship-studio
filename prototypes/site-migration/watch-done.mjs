#!/usr/bin/env node
/**
 * Emit once a trial has finished every phase.
 *
 * Separate from `watch-trials.mjs`, which reports every change: this one is
 * silent until a migration is actually done, so it can be left running without
 * producing noise for the many hours a real one takes.
 *
 * Usage: node prototypes/site-migration/watch-done.mjs <dir> [<dir> …]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: watch-done.mjs <project-dir> [<project-dir> …]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const announced = new Set();

for (let i = 0; i < 400; i += 1) {
  for (const root of roots) {
    if (announced.has(root)) continue;
    try {
      const s = JSON.parse(await readFile(path.join(root, '.shipstudio/migration.json'), 'utf8'));
      const phases = s.phases ?? [];
      if (phases.length > 0 && phases.every((p) => p.status === 'done')) {
        announced.add(root);
        console.log(
          `DONE ${path.basename(root)} — ${s.done?.length ?? 0} done, ` +
            `${s.notDone?.length ?? 0} outstanding, ${s.needsYou?.length ?? 0} questions open`
        );
      }
    } catch {
      /* not readable yet */
    }
  }
  if (announced.size === roots.length) break;
  await sleep(30000);
}
