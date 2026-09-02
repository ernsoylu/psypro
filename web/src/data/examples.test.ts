/**
 * The Phase 11 acceptance gate: worked examples graded against their sources.
 *
 * *"A worked example from a named textbook loads, and its reported values match
 * the book within the documented tolerance, with each step's equation
 * inspectable."*
 *
 * The tolerance is part of each citation rather than a global fudge. A book
 * printing 47.9 kJ/kg is not claiming 47.9087, and grading against more digits
 * than were published tests the typesetting rather than the physics.
 *
 * These run against the **real engine**, loaded off disk. Mocking it would make
 * this a test of the fixture.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { EXAMPLES } from './index';
import {
  calculate_state,
  explain_state,
  initEngine,
  measure_real_gas_correction,
  InputState,
  StatePointInput,
} from '../psychro';

beforeAll(async () => {
  const wasm = readFileSync(join(process.cwd(), 'src/wasm/psychro_bg.wasm'));
  await initEngine(wasm);
});

/** The engine's input mode for the letter a data file uses. */
const MODES = {
  rh: InputState.DbtRh,
  wb: InputState.DbtWbt,
  dp: InputState.DbtDewPoint,
  w: InputState.DbtHumidityRatio,
  h: InputState.DbtEnthalpy,
} as const;

describe('worked examples', () => {
  for (const example of EXAMPLES) {
    describe(example.title, () => {
      const build = () =>
        new StatePointInput(
          example.state.dryBulb,
          example.state.value,
          MODES[example.state.mode],
          example.state.altitudeM,
          true,
          true,
        );

      it(`matches ${example.source}`, () => {
        const state = calculate_state(build()) as unknown as Record<string, number>;
        for (const expected of example.expected) {
          const actual = state[expected.property];
          expect(actual, `${expected.property} is not a reported property`).toBeTypeOf(
            'number',
          );
          expect(
            Math.abs((actual as number) - expected.value),
            `${expected.property}: engine ${actual}, ${example.source} ${expected.value}`,
          ).toBeLessThanOrEqual(expected.tolerance);
        }
      });

      it('shows its working, with a reference on every step', () => {
        const steps = explain_state(build());
        expect(steps.length).toBeGreaterThan(5);
        for (const step of steps) {
          // An equation with no numbers in it is a formula, not working. The
          // substitution is the part that turns one into the other.
          expect(step.equation.length).toBeGreaterThan(5);
          expect(step.substitution).toMatch(/\d/);
          expect(step.result.length).toBeGreaterThan(0);
          // A step without a citation is an assertion, and this is a teaching
          // tool: "trust me" is the one thing it must not say.
          expect(step.reference.length, `${step.property} cites nothing`).toBeGreaterThan(
            8,
          );
        }
      });
    });
  }

  it('names the traps §3.2 warns about', () => {
    const steps = explain_state(
      new StatePointInput(24, 50, InputState.DbtRh, 0, true, true),
    );
    const cautions = steps
      .filter((s) => s.caution.length > 0)
      .map((s) => `${s.property}: ${s.caution}`)
      .join('\n');

    // The three distinctions the whole project is organised around have to be
    // named where a student meets them, not only in a document they will not read.
    expect(cautions).toMatch(/degree of saturation/i);
    expect(cautions).toMatch(/thermodynamic|adiabatic saturation/i);
    expect(cautions).toMatch(/dry air/i);
  });

  it('flags a sub-freezing dew point as a frost point', () => {
    const cold = explain_state(
      new StatePointInput(-10, 60, InputState.DbtRh, 0, true, true),
    );
    const dp = cold.find((s) => s.property === 'dp');
    expect(dp?.caution).toMatch(/frost/i);

    const warm = explain_state(
      new StatePointInput(24, 50, InputState.DbtRh, 0, true, true),
    );
    expect(warm.find((s) => s.property === 'dp')?.caution).toBe('');
  });
});

describe('the ideal-gas toggle', () => {
  it('measures the correction rather than asserting it', () => {
    // §11: showing a student the size of the real-gas correction requires being
    // able to compute without it. "About half a percent" is a fact they must
    // take on trust; a number that moves when they flip a switch is not.
    const c = measure_real_gas_correction(24, 50, 0, true);
    expect(c.w_real).toBeGreaterThan(c.w_ideal);
    expect(c.percent).toBeGreaterThan(0.1);
    expect(c.percent).toBeLessThan(2);
  });

  it('grows with pressure, which is what the enhancement factor is', () => {
    const sea = measure_real_gas_correction(30, 60, 0, true);
    const high = measure_real_gas_correction(30, 60, 2500, true);
    // The factor corrects for the vapour not being an ideal gas in the presence
    // of air; it is a function of pressure, so it must not be a constant.
    expect(Math.abs(high.percent - sea.percent)).toBeGreaterThan(0.001);
  });
});
