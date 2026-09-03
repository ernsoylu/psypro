/**
 * The free-cooling design a year of weather is counted against.
 *
 * **SI, always.** Phase 12 makes these editable alongside the rest of the design
 * case; until then they are the comfort-cooling defaults §4.9 and §4.3 quote —
 * 13 °C supply, a 24 °C / 50% RH return, a 21 °C economiser high limit, and
 * 300 mm rigid media at 0.85 wet-bulb depression effectiveness.
 *
 * They live here rather than in `App.tsx` so that the one place that reads them
 * — the weather worker — and the test that pins its unit handling can point at
 * the same definition. The worker analyses in SI whatever the document is
 * written in; see `epw.worker.ts` for why.
 */

/** The thresholds the hour counts are taken against, in SI. */
export const WEATHER_DESIGN_SI = {
  /** Supply dry-bulb the system has to reach, °C. */
  tSupply: 13,
  /** Return-air enthalpy the economiser compares against, kJ/kg_da. */
  hReturn: 47.9,
  /** Fixed high limit above which the economiser locks out, °C. */
  tHighLimit: 21,
  /** Wet-bulb depression effectiveness of the evaporative stage, 0 to 1. */
  evaporative: 0.85,
} as const;
