#!/usr/bin/env node
/**
 * Print the exact prompt the app queues for a migration.
 *
 * Read out of `src/lib/migration.ts` rather than copied, because a trial that
 * exercises a prompt the product does not actually send is a trial of nothing.
 *
 * Node strips the types itself, so no build step is involved. The imports are
 * dropped first: the only one is Tauri's core, which the prompt builders do
 * not touch — they are pure string building — and which cannot resolve outside
 * a webview anyway.
 *
 * Usage: node prototypes/site-migration/print-prompt.mjs <url> [--resume]
 */

import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../src/lib/migration.ts');

const url = process.argv[2];
if (!url) {
  console.error('usage: print-prompt.mjs <url> [--resume]');
  process.exit(2);
}

const ts = await readFile(source, 'utf8');
const withoutImports = ts.replace(/^import .*$/gm, '');

const dir = await mkdtemp(path.join(tmpdir(), 'migration-prompt-'));
const file = path.join(dir, 'migration.ts');
await writeFile(file, withoutImports);

const mod = await import(pathToFileURL(file).href);
const build = process.argv.includes('--resume')
  ? mod.buildResumePrompt
  : mod.buildMigrationPrompt;
process.stdout.write(build(url));
