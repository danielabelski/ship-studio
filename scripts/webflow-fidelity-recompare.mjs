#!/usr/bin/env node
/**
 * Redraw the diff images from captures already on disk.
 *
 * Capturing two full-page screenshots per breakpoint takes minutes and hits
 * the network; changing how the diff is *drawn* should not. This walks a run
 * directory, re-runs the comparison against the reference.png/rebuild.png
 * already there, and rewrites diff.png and the scores.
 *
 * Usage: node scripts/webflow-fidelity-recompare.mjs public/migration-demo
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CDP_PORT = 9337;
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every directory under `root` holding a reference/rebuild pair. */
async function findPairs(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (existsSync(path.join(child, 'reference.png'))) found.push(child);
      else await walk(child);
    }
  }
  await walk(root);
  return found.sort();
}

async function main() {
  const root = path.resolve(process.argv[2] ?? 'public/migration-demo');
  if (!CHROME) {
    console.error('No Chrome or Chromium found.');
    process.exit(2);
  }

  const { COMPARE_IN_PAGE, PIXEL_THRESHOLD_SQ } = await import('./webflow-fidelity-compare.mjs');
  const pairs = await findPairs(root);
  if (!pairs.length) {
    console.error(`No reference/rebuild pairs under ${root}`);
    process.exit(1);
  }

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      `--user-data-dir=${path.join(process.env.TMPDIR ?? '/tmp', 'shipstudio-recompare-chrome')}`,
    ],
    { stdio: 'ignore' }
  );

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        break;
      } catch {
        await sleep(250);
      }
    }

    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const evaluate = async (expression) => {
      const msg = await new Promise((r) => {
        const i = ++id;
        pending.set(i, r);
        ws.send(
          JSON.stringify({
            id: i,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true },
          })
        );
      });
      if (msg.result?.exceptionDetails) throw new Error('evaluate failed');
      return msg.result.result.value;
    };

    for (const dir of pairs) {
      const width = Number(path.basename(dir));
      const [ref, reb] = await Promise.all([
        readFile(path.join(dir, 'reference.png')),
        readFile(path.join(dir, 'rebuild.png')),
      ]);
      const args = JSON.stringify({
        referenceUrl: `data:image/png;base64,${ref.toString('base64')}`,
        rebuildUrl: `data:image/png;base64,${reb.toString('base64')}`,
        width,
        threshold: PIXEL_THRESHOLD_SQ,
      });
      const result = await evaluate(`(${COMPARE_IN_PAGE})(${args})`);
      await writeFile(path.join(dir, 'diff.png'), Buffer.from(result.diff, 'base64'));
      console.log(`  ${path.relative(process.cwd(), dir)} → ${result.score}%`);
    }
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
