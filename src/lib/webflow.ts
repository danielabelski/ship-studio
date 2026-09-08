/**
 * Webflow migration — types and the data layer behind the Fidelity panel.
 *
 * The question this feature answers is "does the rebuild still look like the
 * site", and the answer has to be *measured*, not asserted. Everything here is
 * shaped around that: a comparison exists or it doesn't, and one that hasn't
 * been run yet is a state of its own rather than a zero. Inventing a score for
 * a template nobody has compared would be exactly the kind of constructed data
 * the project's first principle forbids.
 *
 * The reads currently resolve against files written by
 * `scripts/webflow-fidelity.mjs`. In the shipped version they become Tauri
 * commands; the shapes are the contract either way.
 *
 * @module lib/webflow
 */

/**
 * Where a migration is reading the site from, best first.
 *
 * These are not interchangeable and the difference is not cosmetic — each tier
 * can carry strictly less than the one above it, and a user who picks the
 * bottom one deserves to know what they gave up before they spend an afternoon
 * on it rather than after.
 */
export type WebflowSourceKind = 'account' | 'export' | 'url';

export interface WebflowSourceTier {
  kind: WebflowSourceKind;
  label: string;
  detail: string;
  /** What this tier can bring across. */
  brings: string[];
  /** What it cannot, stated plainly. */
  misses: string[];
  requirement: string | null;
}

export const WEBFLOW_SOURCE_TIERS: readonly WebflowSourceTier[] = [
  {
    kind: 'account',
    label: 'Connect Webflow',
    detail: 'Reads the site through Webflow’s own API.',
    brings: [
      'Variables, as real design tokens',
      'Components with their props',
      'CMS collections and their content',
      'Assets, locales and page metadata',
    ],
    misses: ['Interactions still have no export format'],
    requirement: 'Sign in to Webflow',
  },
  {
    kind: 'export',
    label: 'Export .zip',
    detail: 'The code export from your site settings.',
    brings: ['Every static page as it renders', 'The full stylesheet', 'Images, video and fonts'],
    misses: [
      'No CMS content — collection pages come across empty',
      'Variables arrive as plain CSS',
    ],
    requirement: 'Needs a paid Webflow plan',
  },
  {
    kind: 'url',
    label: 'Published URL',
    detail: 'Reads the live site, like a visitor.',
    brings: ['Every page that is linked from another', 'How the site actually renders'],
    misses: [
      'No CMS schema — only the rows that happen to be published',
      'No component boundaries',
      'Nothing behind a password',
    ],
    requirement: null,
  },
] as const;

/** One breakpoint's comparison. Webflow authors at 1440/991/767/479. */
export interface BreakpointComparison {
  breakpoint: number;
  /** Percentage of pixels that match. The worst breakpoint is the template's score. */
  score: number;
  differingPixels: number;
  totalPixels: number;
  /** Full-page heights. A large gap is a layout fault the score understates. */
  referenceHeight: number;
  rebuildHeight: number;
  /** Directory holding reference.png, rebuild.png and diff.png. */
  dir: string;
}

/**
 * A template that has been compared, or one that has not.
 *
 * The discriminant is the point. A template with no comparison has no score,
 * and the UI is required to say so rather than render a placeholder number
 * that reads as a measurement.
 */
export type TemplateFidelity =
  | {
      template: string;
      route: string;
      status: 'compared';
      /** Worst breakpoint, never a mean — an average hides a broken phone layout. */
      score: number;
      capturedAt: string;
      breakpoints: BreakpointComparison[];
    }
  | {
      template: string;
      route: string;
      status: 'not-compared';
      /** Why there is no number yet, in the user's terms. */
      reason: string;
    };

export interface FidelityRun {
  reference: string;
  rebuild: string;
  /**
   * Set when the rebuild side is not really a rebuild.
   *
   * The prototype measures the loop against the original page with a
   * stylesheet of deliberate mistakes over it, because there is no generated
   * code to measure yet. That makes both URLs identical, which would read as a
   * broken comparison — so the panel says what it is instead.
   */
  rebuildOverlay: string | null;
  templates: TemplateFidelity[];
  /** One entry per pass of the loop, oldest first. Empty until a second pass. */
  history: { iteration: number; score: number; note: string }[];
}

/** Bands the score is read in. Kept here so the panel and its copy agree. */
export type FidelityBand = 'match' | 'close' | 'off' | 'broken';

/**
 * Where the thresholds come from: the engine's own noise floor is ~0.3% on a
 * page compared against itself, so anything at or above 99.5 is as close as
 * the measurement can tell. Below 95 a person notices without being asked to
 * look, and below 85 the page is not the same page.
 */
export function fidelityBand(score: number): FidelityBand {
  if (score >= 99.5) return 'match';
  if (score >= 95) return 'close';
  if (score >= 85) return 'off';
  return 'broken';
}

export const FIDELITY_BAND_LABEL: Record<FidelityBand, string> = {
  match: 'Matches',
  close: 'Close',
  off: 'Off',
  broken: 'Broken',
};

/** Worst breakpoint across every compared template, or null if none are. */
export function runScore(run: FidelityRun): number | null {
  const scores = run.templates.flatMap((t) => (t.status === 'compared' ? [t.score] : []));
  return scores.length ? Math.min(...scores) : null;
}

/** Raw shape written by `scripts/webflow-fidelity.mjs`. */
interface FidelityReport {
  label: string;
  reference: string;
  rebuild: string;
  capturedAt: string;
  score: number;
  breakpoints: BreakpointComparison[];
  rebuildCss?: string | null;
}

/**
 * Load a run.
 *
 * `base` is the directory the capture script wrote to, served statically. The
 * shipped version replaces this with an invoke; the return shape does not
 * change, which is the reason for the indirection.
 */
export async function loadFidelityRun(base: string): Promise<FidelityRun> {
  const report = (await fetch(`${base}/v1/report.json`).then((r) => {
    if (!r.ok) throw new Error(`No fidelity report at ${base}`);
    return r.json();
  })) as FidelityReport;

  const history = await loadHistory(base);

  return {
    reference: report.reference,
    rebuild: report.rebuild,
    rebuildOverlay: report.rebuildCss ?? null,
    history,
    templates: [
      {
        template: report.label,
        route: '/',
        status: 'compared',
        score: report.score,
        capturedAt: report.capturedAt,
        breakpoints: report.breakpoints.map((b) => ({
          ...b,
          dir: `${base}/v1/${report.label}/${b.breakpoint}`,
        })),
      },
      // Deliberately unmeasured. A migration reaches templates one at a time,
      // and the panel has to be honest about the ones it has not reached.
      {
        template: 'about',
        route: '/about',
        status: 'not-compared',
        reason: 'Not rebuilt yet',
      },
      {
        template: 'work',
        route: '/work',
        status: 'not-compared',
        reason: 'Not rebuilt yet',
      },
      {
        template: 'post',
        route: '/post/[slug]',
        status: 'not-compared',
        reason: 'CMS template — needs collection content',
      },
    ],
  };
}

/**
 * Each pass of the loop, read from the per-iteration reports.
 *
 * Missing iterations are skipped rather than interpolated: the history is a
 * record of comparisons that were actually run.
 */
async function loadHistory(base: string): Promise<FidelityRun['history']> {
  const notes = [
    'First pass',
    'Container width corrected to 1200px',
    'Type scale corrected to the site’s values',
    'Accent colour taken from the variable',
  ];

  const entries = await Promise.all(
    [1, 2, 3, 4].map(async (iteration) => {
      try {
        const res = await fetch(`${base}/v${iteration}/report.json`);
        if (!res.ok) return null;
        const report = (await res.json()) as FidelityReport;
        return { iteration, score: report.score, note: notes[iteration - 1] ?? '' };
      } catch {
        return null;
      }
    })
  );

  return entries.filter((e): e is FidelityRun['history'][number] => e !== null);
}
