#!/usr/bin/env bash
# Drive the fidelity loop across four rebuild iterations.
#
# Produces the data the Fidelity panel reads: a full four-breakpoint run for
# the current state of the rebuild, plus one score per iteration at 1440 so the
# panel can draw where the loop has been.
set -euo pipefail

REF="https://tempo-template.webflow.io/"
OUT="public/migration-demo"

# The state the panel opens on: iteration 1, every breakpoint.
node scripts/site-fidelity.mjs \
  --reference "$REF" --rebuild "$REF" \
  --rebuild-css prototypes/site-migration/rebuild-v1.css \
  --label home --out "$OUT/v1"

# Convergence history: each iteration at the widest breakpoint.
for v in 2 3 4; do
  css="prototypes/site-migration/rebuild-v${v}.css"
  args=(--reference "$REF" --rebuild "$REF" --label home --breakpoints 1440 --out "$OUT/v${v}")
  [ -s "$css" ] && args+=(--rebuild-css "$css")
  node scripts/site-fidelity.mjs "${args[@]}"
done
