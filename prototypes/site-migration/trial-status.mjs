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
try {
  const runs = [];
  for (const entry of await readdir(fidelity, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const report = JSON.parse(
        await readFile(path.join(fidelity, entry.name, 'report.json'), 'utf8')
      );
      runs.push(
        `  ${entry.name.padEnd(18)} ${String(report.score).padStart(6)}%  ` +
          `${(report.breakpoints ?? []).map((b) => `${b.breakpoint}:${b.score}`).join('  ')}`
      );
    } catch {
      runs.push(`  ${entry.name.padEnd(18)} (no report yet)`);
    }
  }
  console.log('');
  console.log(runs.length ? `fidelity runs\n${runs.join('\n')}` : 'fidelity runs   none yet');
} catch {
  console.log('\nfidelity runs   none yet');
}

for (const file of ['MIGRATION.md']) {
  try {
    const s = await stat(path.join(root, file));
    console.log(`\n${file}   ${s.size} bytes, touched ${since(s.mtime)}`);
  } catch {
    console.log(`\n${file}   not written`);
  }
}
