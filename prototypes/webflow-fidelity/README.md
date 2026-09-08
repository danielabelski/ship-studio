# Webflow fidelity — prototype

Proving one claim: **a Webflow migration can be measured, and the measurement
can be closed as a loop.**

The old `webflow-to-code` plugin analysed an export, wrote a markdown brief and
stopped. Whether the result resembled the original was never checked by
anything. This is the missing half.

## What was actually run

Reference site: [`tempo-template.webflow.io`](https://tempo-template.webflow.io/)
— a real Webflow template, 12,558px tall at 1440, with sliders, IX2 scroll
interactions and lazy images.

```
89.25%  →  95.45%  →  98.38%  →  100.00%
```

Four passes at 1440px, one fix each:

| Pass | Score | Fix |
|------|-------|-----|
| 1 | 89.25% | — three mistakes in place |
| 2 | 95.45% | `.container` max-width 1140 → 1200 |
| 3 | 98.38% | type scale returned to the site's own 44/50 and 19/30 |
| 4 | 100.00% | accent colour taken from the variable, not by eye |

And the full four-breakpoint state of pass 1:

| 1440 | 991 | 767 | 479 |
|------|-----|-----|-----|
| 89.25% | 92.19% | 92.31% | 89.87% |

## Honesty about the rebuild side

There is no generated code yet. The "rebuild" is the **live page with a
stylesheet of deliberate mistakes over it** (`rebuild-v1.css` … `v4.css`), so
the loop has something real to measure before the ingest exists.

That makes the *rendering differences* real and the *mistakes* real — they are
the errors migrations actually make — but it is not a from-scratch rebuild. The
panel says so rather than showing two identical URLs and letting you assume.

## The engine is trustworthy

Determinism was the first thing that had to be true, and the first version was
not:

- Comparing the page **against itself** scored **96.5%** — 3.5% of pure noise,
  which would have swamped any real signal in the last few points.
- Causes: animations pinned *after* the page had settled rather than before it
  painted, Webflow sliders autoplaying on a timer, and the two captures running
  in parallel and contending for CPU.
- Fixed by injecting the freeze stylesheet via
  `Page.addScriptToEvaluateOnNewDocument`, tearing down `Webflow` and resetting
  every slider, and capturing sequentially.
- Self-comparison is now **99.96%** at 1440 and **99.69%** at 479. That ~0.3%
  is the noise floor, and it is where the "Matches" band threshold comes from.

Re-running the comparison from the saved PNGs reproduces every score exactly,
which is the other half of the same claim.

## The limitation worth knowing before building this

**A pixel diff is a good regression signal and a poor diagnostic.**

Look at the Difference view: whole photographs are solid magenta. Nothing is
wrong with them — the container is 60px narrower, so every image *shifted*, and
a shifted image differs from the original at nearly every pixel. The score is
right that something is off; the picture badly overstates how much, and it
never names the cause.

So the number is genuinely good for "did my fix help, and did fixing 1440 break
767" — which is the loop. It is weak at "what is wrong", which is what the
agent most needs on the first pass.

The answer is not a better pixel diff. It is to compare **layout boxes** —
element positions and sizes read from both DOMs — so the finding reads
`.container is 1140px wide, expected 1200px` instead of ten percent of the page
turning magenta. The pixel score stays as the acceptance check. That is the
next thing I would build, and I would build it before the ingest.

## Running it

```bash
# Measure a rebuild against the original
node scripts/webflow-fidelity.mjs \
  --reference https://tempo-template.webflow.io/ \
  --rebuild http://127.0.0.1:3000/ \
  --out public/webflow-demo/v1

# Reproduce the four-pass demo
bash prototypes/webflow-fidelity/run-demo.sh

# Redraw diff images from captures already on disk (no network, seconds)
node scripts/webflow-fidelity-recompare.mjs public/webflow-demo
```

## Seeing the UI

```bash
pnpm harness --port 1426
```

Then <http://127.0.0.1:1426/harness.html?scenario=webflow-fidelity&command=webflow.fidelity>,
or open any scenario and press `⌘K` → "Check fidelity against Webflow".

Two scenarios are registered: `webflow-fidelity` and `webflow-import`. The
Overlay and Difference views have no scenario because the harness runs a
scenario's `steps` before its `command`, so a step cannot reach a control
inside a modal the command is what opens — worth fixing in the harness, but not
here.

## What is not built

- Any ingest. The source picker's buttons say so instead of pretending.
- Any Rust. The panel reads JSON and PNGs written by the script and served
  statically; `src/lib/webflow.ts` is shaped so those reads become `invoke`
  calls without the components changing.
- Template discovery. Three of the four rows in the matrix are honestly marked
  "not compared" rather than given invented scores.
