/**
 * Every template against every breakpoint, as one grid.
 *
 * A migration's real failure mode is not "the site is wrong" — it is "the site
 * is right at 1440 and falls apart at 767, and nobody looked". A row per
 * template and a column per breakpoint puts that where it cannot be missed:
 * a bad column reads as a vertical stripe.
 *
 * Cells for templates nobody has compared show no number at all. There is a
 * strong temptation to render those as 0% or "—" with a score colour, and both
 * are lies: one says the rebuild is broken, the other implies a measurement
 * happened. They get their own state and their own reason.
 */

import { fidelityBand, FIDELITY_BAND_LABEL, type TemplateFidelity } from '@/lib/migration';

interface FidelityMatrixProps {
  templates: TemplateFidelity[];
  /** Column order, widest first — the way breakpoints are usually written. */
  breakpoints: number[];
  selected: { template: string; breakpoint: number } | null;
  onSelect: (template: string, breakpoint: number) => void;
}

export function FidelityMatrix({
  templates,
  breakpoints,
  selected,
  onSelect,
}: FidelityMatrixProps) {
  return (
    <table className="mig-matrix">
      <caption className="mig-matrix__caption">
        Pixel match against the original, per breakpoint
      </caption>
      <thead>
        <tr>
          <th scope="col" className="mig-matrix__corner">
            Template
          </th>
          {breakpoints.map((bp) => (
            <th scope="col" key={bp} className="mig-matrix__head">
              {bp}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {templates.map((template) => (
          <tr key={template.template}>
            <th scope="row" className="mig-matrix__row-head">
              <span className="mig-matrix__name">{template.template}</span>
              <span className="mig-matrix__route">{template.route}</span>
            </th>

            {template.status === 'not-compared' ? (
              <td className="mig-matrix__pending" colSpan={breakpoints.length}>
                {template.reason}
              </td>
            ) : (
              breakpoints.map((bp) => {
                const cell = template.breakpoints.find((b) => b.breakpoint === bp);
                if (!cell) {
                  return (
                    <td key={bp} className="mig-matrix__cell mig-matrix__cell--empty">
                      <span className="mig-matrix__none">not run</span>
                    </td>
                  );
                }
                const band = fidelityBand(cell.score);
                const isSelected =
                  selected?.template === template.template && selected.breakpoint === bp;
                return (
                  <td key={bp} className="mig-matrix__cell">
                    <button
                      type="button"
                      className={`mig-score mig-score--${band}${isSelected ? ' mig-score--selected' : ''}`}
                      aria-pressed={isSelected}
                      title={`${FIDELITY_BAND_LABEL[band]} — ${cell.differingPixels.toLocaleString()} pixels differ`}
                      onClick={() => onSelect(template.template, bp)}
                    >
                      <span className="mig-score__value">{cell.score.toFixed(1)}</span>
                      <span className="mig-score__unit">%</span>
                    </button>
                  </td>
                );
              })
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
