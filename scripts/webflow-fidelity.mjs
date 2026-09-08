#!/usr/bin/env node
/**
 * Measure how close a rebuild is to the site it was rebuilt from.
 *
 * A Webflow migration is judged on one thing — does it still look like the
 * site — and that is the one thing nothing in the old `webflow-to-code`
 * pipeline ever checked. It analysed an export, wrote a markdown brief, and
 * stopped. Whether the result resembled the original was left to whoever
 * happened to scroll past it.
 *
 * This turns that into a number the agent can close a loop on:
 *
 *     build → compare → fix → compare → …
 *
 * Both sides are screenshotted at Webflow's own breakpoints, because a
 * migration that matches at 1440 and collapses at 767 is the normal failure,
 * not an exotic one. Webflow authors against 1440/991/767/479, so those are
 * the widths where its media queries actually change hands.
 *
 * Dependency-free on purpose, matching `harness-capture.mjs`: it speaks the
 * Chrome DevTools Protocol over Node's built-in WebSocket and fetch. The pixel
 * comparison runs *inside* a page rather than in Node, which sidesteps PNG
 * decoding entirely — the browser already has a decoder and a canvas, so the
 * whole image pipeline is a `Runtime.evaluate` away.
 *
 * Usage:
 *   node scripts/webflow-fidelity.mjs --reference https://x.webflow.io/ \
 *                                     --rebuild http://127.0.0.1:4321/ \
 *                                     --out prototypes/webflow-fidelity/run
 *
 *   --breakpoints 1440,991,767,479   override the widths
 *   --label hero                     name this template in the report
 *   --settle 1200                    ms to wait after load before capturing
 *
 * Writes `<out>/<label>/<width>/{reference,rebuild,diff}.png` and a
 * `report.json` in the shape the Fidelity panel consumes.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { COMPARE_IN_PAGE, PIXEL_THRESHOLD_SQ } from './webflow-fidelity-compare.mjs';

const CDP_PORT = Number(process.env.SHIPSTUDIO_FIDELITY_CDP_PORT ?? 9334);

/** Webflow's authoring breakpoints. Its media queries change hands here. */
const DEFAULT_BREAKPOINTS = [1440, 991, 767, 479];



const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CDP plumbing ──────────────────────────────────────────────────────────

/** Minimal CDP session over one page target. */
class Page {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(wsUrl) {
    const page = new Page();
    page.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      page.#ws.addEventListener('open', resolve, { once: true });
      page.#ws.addEventListener('error', reject, { once: true });
    });
    page.#ws.addEventListener('message', (ev) => page.#onMessage(String(ev.data)));
    await page.send('Runtime.enable');
    return page;
  }

  #onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return res.result.value;
  }

  close() {
    this.#ws.close();
  }
}

async function newPage(url) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  const target = await res.json();
  return { page: await Page.attach(target.webSocketDebuggerUrl), targetId: target.id };
}

const closeTarget = (id) => fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`).catch(() => {});

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await sleep(250);
  }
}

// ─── Capture ───────────────────────────────────────────────────────────────

/**
 * CSS that pins every animation to its *end* state, injected before the page's
 * own scripts run.
 *
 * Pausing an animation freezes it wherever it happens to be, which is a
 * different place on every run — the capture then records timing, not layout.
 * Running it once, instantly, with a negative delay lands every element on its
 * final frame, which is both deterministic and the state a visitor sees a
 * moment after arriving. Lifted from `src/harness/freeze.css`, which learned
 * this the same way.
 */
const FREEZE_CSS = `
*,*::before,*::after{
  animation-delay:-1ms!important;
  animation-duration:1ms!important;
  animation-iteration-count:1!important;
  animation-play-state:paused!important;
  transition-duration:0ms!important;
  transition-delay:0ms!important;
  caret-color:transparent!important;
  scroll-behavior:auto!important;
}
`;

/**
 * Stop the parts of a Webflow page that keep moving on their own.
 *
 * Two of them, and neither is CSS. Sliders autoplay on a timer, so which slide
 * is on screen depends on when the shutter opened. IX2 — Webflow's interaction
 * runtime — writes inline transforms as you scroll, and leaves them behind.
 * `Webflow.destroy()` tears both down; resetting each slider to its first
 * slide afterwards makes "which slide" a fixed answer rather than a race.
 */
const SETTLE_WEBFLOW = `
(() => {
  try { window.Webflow && window.Webflow.destroy && window.Webflow.destroy(); } catch {}
  document.querySelectorAll('.w-slider').forEach((slider) => {
    const dots = slider.querySelectorAll('.w-slider-dot');
    if (dots.length) dots[0].click();
    const mask = slider.querySelector('.w-slider-mask');
    if (mask) mask.scrollLeft = 0;
    slider.querySelectorAll('.w-slide').forEach((slide, i) => {
      slide.style.transform = 'translateX(' + i * 100 + '%)';
    });
  });
  document.querySelectorAll('video').forEach((v) => {
    try { v.pause(); v.currentTime = 0; } catch {}
  });
  return true;
})()
`;

/**
 * Full-page screenshot of `url` as it renders at `width`.
 *
 * The device metrics override is what makes this a *breakpoint* capture rather
 * than a window resize: the page's media queries evaluate against the width we
 * set, and `deviceScaleFactor: 1` keeps the pixel grid comparable between the
 * two sides regardless of the host display.
 *
 * Captures are taken one at a time by the caller, never in parallel. Two tabs
 * rendering at once contend for the same CPU, and the slower one settles its
 * animations and lazy images at a different point — which shows up in the diff
 * as error the rebuild did not cause.
 */
async function capture(url, width, settleMs, extraCss) {
  const { page, targetId } = await newPage('about:blank');
  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width <= 767,
    });
    await page.send('Page.enable');
    // Before any page script: the freeze has to be in the cascade from the
    // first paint, or load-time interactions have already run somewhere
    // arbitrary by the time we could inject it.
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = ${JSON.stringify(FREEZE_CSS)};
          document.head.appendChild(s);
        });
      `,
    });
    await page.send('Page.navigate', { url });

    // Settle: document ready, webfonts swapped in, lazy images decoded.
    const deadline = Date.now() + 20000;
    for (;;) {
      const ready = await page
        .eval(`document.readyState === 'complete' && document.fonts.status === 'loaded'`)
        .catch(() => false);
      if (ready || Date.now() > deadline) break;
      await sleep(200);
    }
    await page.eval(`
      (async () => {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 400));
        window.scrollTo(0, 0);
        await Promise.all(
          [...document.images].filter((i) => !i.complete).map((i) =>
            new Promise((r) => { i.onload = i.onerror = r; })
          )
        );
      })()
    `);
    await sleep(settleMs);
    await page.eval(SETTLE_WEBFLOW);

    // Stand-in for generated code (see prototypes/webflow-fidelity/README.md):
    // overlaying CSS on the live page produces a rendering that differs from
    // the reference in specific, nameable ways, which is what the loop needs
    // to be exercised against before any real migration output exists.
    if (extraCss) {
      await page.eval(`
        (() => {
          const s = document.createElement('style');
          s.textContent = ${JSON.stringify(extraCss)};
          document.head.appendChild(s);
          return true;
        })()
      `);
      await sleep(250);
    }
    await sleep(200);

    const { data } = await page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    const height = await page.eval(
      `Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`
    );
    return { data, height };
  } finally {
    page.close();
    closeTarget(targetId);
  }
}

// ─── Comparison ────────────────────────────────────────────────────────────



async function compare(referenceB64, rebuildB64, width) {
  const { page, targetId } = await newPage('about:blank');
  try {
    const args = JSON.stringify({
      referenceUrl: `data:image/png;base64,${referenceB64}`,
      rebuildUrl: `data:image/png;base64,${rebuildB64}`,
      width,
      threshold: PIXEL_THRESHOLD_SQ,
    });
    return await page.eval(`(${COMPARE_IN_PAGE})(${args})`);
  } finally {
    page.close();
    closeTarget(targetId);
  }
}

// ─── Runner ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
    args[key] = value ?? 'true';
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reference = args.reference;
  const rebuild = args.rebuild;
  if (!reference || !rebuild) {
    console.error('Usage: --reference <url> --rebuild <url> [--out dir] [--label name]');
    process.exit(2);
  }
  if (!CHROME) {
    console.error('No Chrome or Chromium found.');
    process.exit(2);
  }

  const label = args.label ?? 'home';
  const outDir = path.resolve(args.out ?? 'prototypes/webflow-fidelity/run');
  const settleMs = Number(args.settle ?? 900);
  const rebuildCss = args['rebuild-css']
    ? await readFile(path.resolve(args['rebuild-css']), 'utf8')
    : null;
  const breakpoints = (args.breakpoints ?? DEFAULT_BREAKPOINTS.join(','))
    .split(',')
    .map((n) => Number(n.trim()))
    .filter(Boolean);

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(process.env.TMPDIR ?? '/tmp', 'shipstudio-fidelity-chrome')}`,
    ],
    { stdio: 'ignore' }
  );

  try {
    await waitForServer(`http://127.0.0.1:${CDP_PORT}/json/version`);

    const results = [];
    for (const width of breakpoints) {
      process.stdout.write(`  ${label} @ ${width}px … `);
      const ref = await capture(reference, width, settleMs);
      const reb = await capture(rebuild, width, settleMs, rebuildCss);
      const cmp = await compare(ref.data, reb.data, width);

      const dir = path.join(outDir, label, String(width));
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(path.join(dir, 'reference.png'), Buffer.from(ref.data, 'base64')),
        writeFile(path.join(dir, 'rebuild.png'), Buffer.from(reb.data, 'base64')),
        writeFile(path.join(dir, 'diff.png'), Buffer.from(cmp.diff, 'base64')),
      ]);

      const { diff: _diff, ...summary } = cmp;
      results.push({ breakpoint: width, ...summary, dir: path.relative(process.cwd(), dir) });
      console.log(`${summary.score}%  (${summary.referenceHeight}px vs ${summary.rebuildHeight}px)`);
    }

    const report = {
      label,
      reference,
      rebuild,
      // Recorded so the panel can say the rebuild side is a stand-in rather
      // than letting two identical URLs imply the comparison is meaningless.
      rebuildCss: args['rebuild-css'] ? path.basename(args['rebuild-css']) : null,
      capturedAt: new Date().toISOString(),
      // The worst breakpoint is the score, not the mean. A migration that is
      // perfect on desktop and broken on mobile is a broken migration, and an
      // average is exactly the statistic that would hide it.
      score: Math.min(...results.map((r) => r.score)),
      breakpoints: results,
    };
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n  worst breakpoint: ${report.score}%  →  ${path.relative(process.cwd(), outDir)}/report.json`);
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
