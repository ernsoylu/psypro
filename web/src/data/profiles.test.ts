/**
 * The promise a profile makes, and the one it must not break.
 *
 * `REQUIREMENTS.md` §10: *"A profile preselects the envelopes, default states,
 * process palette and report template; **it never changes the
 * thermodynamics**."*
 *
 * That is what makes profiles safe to offer at all. A "data centre mode" that
 * quietly swapped a correlation would be a different tool wearing the same name,
 * and two designs compared across profiles would be comparing nothing. So it is
 * asserted rather than promised — byte-identical, not merely close.
 *
 * The envelopes are checked here too, against the values `REQUIREMENTS.md` §5
 * publishes. An overlay is a claim about a standard, and a wrong one is worse
 * than no overlay: a reader trusts it precisely because they have not looked the
 * numbers up themselves.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { ENVELOPES, PROFILES, envelopeById, profileById } from './index';
import {
  calculate_state,
  check_envelope,
  envelope_polygon,
  fogging_margin,
  initEngine,
  ChartLayout,
  InputState,
  StatePointInput,
} from '../psychro';
import { envelopeCoords } from '../chart/ZoneLayer';
import { useProfileStore } from '../store/useProfileStore';

beforeAll(async () => {
  const wasm = readFileSync(join(process.cwd(), 'src/wasm/psychro_bg.wasm'));
  await initEngine(wasm);
});

/** The engine input for a state, unaffected by any profile. */
const at = (t: number, rh: number) =>
  new StatePointInput(t, rh, InputState.DbtRh, 0, true, true);

/**
 * A limit set from a data file, as the eight scalars the boundary takes.
 *
 * Scalars rather than a struct because a `#[wasm_bindgen]` struct is *moved*
 * into Rust when passed, so one shared across three checks would be dead after
 * the first — which is exactly how this test found the problem.
 */
function limitsOf(
  id: string,
): [number, number, number, number, number, number, number, number] {
  const l = envelopeById(id)!.limits;
  return [
    l.tMin,
    l.tMax,
    l.dpMin ?? Number.NaN,
    l.dpMax ?? Number.NaN,
    l.rhMin ?? Number.NaN,
    l.rhMax ?? Number.NaN,
    l.wMin ?? Number.NaN,
    l.wMax ?? Number.NaN,
  ];
}

describe('industry profiles', () => {
  it('changes only presentation, never a computed property', () => {
    const readings = PROFILES.map((profile) => {
      useProfileStore.getState().setProfile(profile.id);
      const s = calculate_state(at(24, 50));
      // Every property the panel would print, as a string, so a difference in
      // the last bit fails rather than rounding away.
      return [
        s.dbt,
        s.wbt,
        s.dew_point,
        s.humidity_ratio,
        s.rh,
        s.degree_of_saturation,
        s.enthalpy,
        s.specific_volume,
        s.density,
        s.vapor_pressure,
        s.barometric_pressure,
      ]
        .map((v) => v.toString())
        .join('|');
    });

    expect(new Set(readings).size).toBe(1);
    expect(PROFILES.length).toBeGreaterThan(1);
  });

  it('seeds its own overlays and drops the previous ones', () => {
    const store = useProfileStore.getState();
    store.setProfile('datacenter');
    expect(useProfileStore.getState().visibleEnvelopes).toEqual(
      profileById('datacenter')!.envelopes,
    );
    // Carrying a data-centre envelope into a comfort design is noise, so a
    // profile switch reseeds rather than merging.
    store.setProfile('hvac');
    expect(useProfileStore.getState().visibleEnvelopes).toEqual(
      profileById('hvac')!.envelopes,
    );
  });

  it('names only envelopes that exist', () => {
    for (const profile of PROFILES) {
      for (const id of profile.envelopes) {
        expect(
          envelopeById(id),
          `${profile.id} names a missing envelope ${id}`,
        ).toBeDefined();
      }
    }
  });

  it('records a sensible-heat-ratio band for each design context', () => {
    // §10.3: a data centre runs at 0.95–1.0, essentially all sensible. A tool
    // that assumed a comfort-range SHR would mislead there, and this is the
    // number that says so.
    expect(profileById('datacenter')!.shrRange[0]).toBeGreaterThanOrEqual(0.9);
    expect(profileById('hvac')!.shrRange[1]).toBeLessThanOrEqual(0.9);
  });
});

describe('envelope data', () => {
  it('publishes the TC 9.9 recommended band REQUIREMENTS §5 states', () => {
    const l = envelopeById('tc99-recommended')!.limits;
    expect([l.tMin, l.tMax]).toEqual([18, 27]);
    // The dew-point floor is −9 °C, far below any comfort humidity — which is
    // why the envelope is much taller than a comfort zone, and why getting it
    // wrong would look plausible.
    expect(l.dpMin).toBe(-9);
    expect(l.dpMax).toBe(15);
    expect(l.rhMax).toBe(60);
  });

  it('publishes the allowable classes with their own dew-point ceilings', () => {
    for (const [id, t, dp] of [
      ['tc99-a1', [15, 32], 17],
      ['tc99-a2', [10, 35], 21],
      ['tc99-a3', [5, 40], 24],
      ['tc99-a4', [5, 45], 24],
    ] as const) {
      const l = envelopeById(id)!.limits;
      expect([l.tMin, l.tMax]).toEqual(t);
      expect(l.dpMax).toBe(dp);
    }
  });

  it('says why every envelope has the bounds it has', () => {
    // §10.3 asks for the reasoning in the UI, not just the numbers: a
    // dew-point ceiling that stops conductive anodic filament growth is a
    // different constraint from one that exists for comfort.
    for (const e of ENVELOPES) {
      expect(e.rationale.length, `${e.id} has no rationale`).toBeGreaterThan(40);
      expect(e.source.length, `${e.id} cites no source`).toBeGreaterThan(10);
    }
  });
});

describe('envelope geometry', () => {
  it('resolves a closed polygon from published limits', () => {
    const coords = envelope_polygon(
      ...limitsOf('tc99-recommended'),
      ChartLayout.Ashrae,
      0,
      true,
      true,
    );
    expect(coords.length).toBeGreaterThan(20);
    expect(coords.length % 2).toBe(0);
    expect(coords.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('moves the envelope when the altitude does', () => {
    const sea = envelope_polygon(
      ...limitsOf('tc99-recommended'),
      ChartLayout.Ashrae,
      0,
      true,
      true,
    );
    const denver = envelope_polygon(
      ...limitsOf('tc99-recommended'),
      ChartLayout.Ashrae,
      1609,
      true,
      true,
    );
    // A relative-humidity bound is a curve whose shape depends on barometric
    // pressure. An outline traced once at sea level is wrong in Denver, and
    // wrong invisibly — which is the whole reason the polygon is computed.
    expect(sea).not.toEqual(denver);
  });

  /**
   * An overlay is a claim about a standard, so it has to be the same claim
   * whichever units the reader happens to be working in. `envelope_polygon`
   * takes one `is_si` flag covering the elevation *and* the eight bounds, and
   * the bounds are published in SI — so handing it the document's unit system
   * read TC 9.9's 18–27 °C band as 18–27 °F and drew the zone at −8 to −3 °C.
   */
  it('draws an envelope in the same place whatever the document is in', () => {
    const envelope = envelopeById('tc99-recommended')!;
    const si = envelopeCoords(envelope, ChartLayout.Ashrae, 0, true);
    expect(si.length).toBeGreaterThan(20);

    // The published band, mapped: at sea level TC 9.9 Recommended spans
    // 18–27 °C, so the outline has to sit over that part of the chart.
    const xs = Array.from(si).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(17);
    expect(Math.max(...xs)).toBeLessThan(30);

    // Reading the same bounds as °F is what the document flag used to do.
    const asFahrenheit = envelope_polygon(
      ...limitsOf('tc99-recommended'),
      ChartLayout.Ashrae,
      0,
      false,
      true,
    );
    expect(Array.from(asFahrenheit)).not.toEqual(Array.from(si));
  });

  it('judges membership from the limits, not from the drawn outline', () => {
    const limits = limitsOf('tc99-recommended');
    // 24 °C / 40% RH is inside; its dew point is about 9.6 °C.
    expect(check_envelope(at(24, 40), ...limits).inside).toBe(true);
    // 30 °C is over the 27 °C ceiling by three kelvin, and the check says so
    // by how much — "outside" alone is not a useful answer.
    const hot = check_envelope(at(30, 40), ...limits);
    expect(hot.inside).toBe(false);
    expect(hot.dry_bulb_excursion).toBeCloseTo(3, 6);
    // 24 °C / 80% RH is inside the dry-bulb band but over the 60% RH ceiling
    // AND over the 15 °C dew-point ceiling: the bound that is violated says
    // which mechanism is at risk.
    const humid = check_envelope(at(24, 80), ...limits);
    expect(humid.inside).toBe(false);
    expect(humid.dry_bulb_excursion).toBe(0);
    expect(humid.relative_humidity_excursion).toBeCloseTo(20, 6);
    expect(humid.dew_point_excursion).toBeGreaterThan(0);
  });
});

describe('the automotive fogging check', () => {
  it('warns when the cabin dew point reaches the inner glass', () => {
    // §10.2. The margin is positive for clear glass and negative for fog.
    const cabin = at(22, 50);
    // Dew point at 22 °C / 50% is about 11.1 °C.
    expect(fogging_margin(cabin, 16)).toBeGreaterThan(0);
    expect(fogging_margin(at(22, 50), 5)).toBeLessThan(0);
  });

  it('depends on dew point rather than relative humidity', () => {
    // The same 50% RH fogs at one cabin temperature and not at another, which
    // is exactly why a cabin model needs a dew point.
    const warm = fogging_margin(at(28, 50), 12);
    const cool = fogging_margin(at(16, 50), 12);
    expect(warm).toBeLessThan(0);
    expect(cool).toBeGreaterThan(0);
  });
});
