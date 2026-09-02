/**
 * "Show the working" — the equation, the substituted values, and the source.
 *
 * §11's first requirement, and the one that distinguishes a teaching tool from
 * a calculator. A calculator says 47.909 kJ/kg. This says
 * `h = 1.006 × 24.00 + 0.009340 × (2499.86 + 1.84 × 24.00)`, and names ASHRAE
 * RP-1485 as where those constants come from.
 *
 * Every step carries a reference, because "trust me" is the one thing a teaching
 * tool must not say. Where a quantity is routinely confused with another, the
 * step carries a caution too — §11 calls that *naming the trap*, and beside the
 * number is the only place it does any good.
 *
 * The strings come from the engine. Re-deriving the substituted values here to
 * display them would be a second implementation of the same physics, in the one
 * place where a divergence would actively teach the wrong thing.
 */

import { useT } from '../i18n/useT';
import type { WorkingStep } from '../psychro';

/** What the working panel needs. */
export interface WorkingPanelProps {
  /** The steps, as the engine produced them. */
  steps: WorkingStep[];
  /** The real-gas correction at this state, if it could be measured. */
  correction: { wReal: number; wIdeal: number; percent: number } | null;
}

export function WorkingPanel({ steps, correction }: WorkingPanelProps) {
  const t = useT();

  return (
    <>
      <h2 className="panel__section">{t('working.section')}</h2>
      <div className="panel__fields">
        {steps.map((step) => (
          <details className="working" key={step.property}>
            <summary className="working__head">
              <code className="working__equation">{step.equation}</code>
            </summary>
            <code className="working__substitution">{step.substitution}</code>
            <p className="working__reference">{step.reference}</p>
            {step.caution ? <p className="working__caution">{step.caution}</p> : null}
          </details>
        ))}

        {correction ? (
          <div className="working working--correction">
            <p className="working__head">{t('working.realGas')}</p>
            <code className="working__substitution">
              {t('working.realGasValues', {
                real: correction.wReal.toFixed(6),
                ideal: correction.wIdeal.toFixed(6),
                percent: correction.percent.toFixed(2),
              })}
            </code>
            <p className="working__reference">{t('working.realGasNote')}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
