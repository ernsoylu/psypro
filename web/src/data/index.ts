/**
 * Envelopes and profiles, loaded from data.
 *
 * `REQUIREMENTS.md` §5: *"Envelopes are data files, not code, so contributors
 * can add one without touching TypeScript."* This module is the seam that makes
 * that true — it types the JSON and nothing else. Adding an envelope means
 * writing down what a standard publishes and stopping there.
 *
 * The types are hand-written rather than derived from the JSON because they are
 * the **schema a contributor writes against**. Inferring them from the current
 * file would make whatever happens to be in it today the definition, and a
 * missing optional bound would look like a type error in the wrong place.
 */

import envelopeData from './envelopes.json';
import profileData from './profiles.json';

/**
 * A published limit set.
 *
 * Bounds are in SI and every one but the dry-bulb pair is optional: TC 9.9
 * Recommended states a dew-point band and an RH ceiling but no humidity-ratio
 * bound, while Standard 55 does the opposite. Omitting a bound means the
 * standard does not state it — which is different from stating zero.
 */
export interface EnvelopeLimitData {
  /** Lower dry-bulb bound, °C. */
  tMin: number;
  /** Upper dry-bulb bound, °C. */
  tMax: number;
  /** Minimum dew point, °C. */
  dpMin?: number;
  /** Maximum dew point, °C. */
  dpMax?: number;
  /** Minimum relative humidity, percent. */
  rhMin?: number;
  /** Maximum relative humidity, percent. */
  rhMax?: number;
  /** Minimum humidity ratio, kg/kg_da. */
  wMin?: number;
  /** Maximum humidity ratio, kg/kg_da. */
  wMax?: number;
}

/** One envelope, as a data file states it. */
export interface Envelope {
  id: string;
  name: string;
  /** Which family it belongs to, for grouping in the UI. */
  group: string;
  /** The `theme.css` variable it is filled with. */
  colorVar: string;
  /** Where the numbers come from. */
  source: string;
  /**
   * *Why* the bounds are where they are.
   *
   * §10.3 asks for this explicitly: state the reasoning in the UI, not just the
   * numbers. A dew-point ceiling that exists to stop conductive anodic filament
   * growth is a different constraint from one that exists for comfort, and a
   * reader who knows which is which can make a judgement about exceeding it.
   */
  rationale: string;
  limits: EnvelopeLimitData;
}

/** An industry profile: presentation and defaults, never thermodynamics. */
export interface Profile {
  id: string;
  name: string;
  /** Envelope ids this profile shows by default. */
  envelopes: string[];
  /** The SHR band this context usually works in. */
  shrRange: [number, number];
  /** What is different about designing in this context. */
  note: string;
  /** Starting values for the design case. */
  defaults: {
    roomT: number;
    roomRh: number;
    supplyT: number;
    outdoorFraction: number;
  };
}

/** Every envelope the build ships with. */
export const ENVELOPES: Envelope[] = envelopeData.envelopes as Envelope[];

/** Every industry profile. */
export const PROFILES: Profile[] = profileData.profiles as Profile[];

/** Looks an envelope up by id. */
export function envelopeById(id: string): Envelope | undefined {
  return ENVELOPES.find((e) => e.id === id);
}

/** Looks a profile up by id. */
export function profileById(id: string): Profile | undefined {
  return PROFILES.find((p) => p.id === id);
}
