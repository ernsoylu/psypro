import { useEffect, useState } from 'react';

import {
  calculate_state,
  engine_version,
  initEngine,
  InputState,
  StatePointInput,
  type StatePointOutput,
} from './psychro';

/** The second-input choices, paired with the label and unit for each. */
const MODES = [
  { state: InputState.DbtRh, label: 'Relative humidity', si: '%', ip: '%' },
  { state: InputState.DbtWbt, label: 'Wet-bulb temperature', si: '°C', ip: '°F' },
  { state: InputState.DbtDewPoint, label: 'Dew point', si: '°C', ip: '°F' },
  { state: InputState.DbtHumidityRatio, label: 'Humidity ratio', si: 'kg/kg', ip: 'lb/lb' },
  { state: InputState.DbtEnthalpy, label: 'Enthalpy', si: 'kJ/kg', ip: 'Btu/lb' },
] as const;

/** Property rows to render, in the order an engineer reads them. */
function rows(o: StatePointOutput, si: boolean) {
  const t = si ? '°C' : '°F';
  return [
    ['Dry-bulb temperature', o.dbt.toFixed(2), t],
    ['Wet-bulb temperature (thermodynamic)', o.wbt.toFixed(2), t],
    [o.dew_point < 0 ? 'Frost point' : 'Dew point', o.dew_point.toFixed(2), t],
    ['Humidity ratio', o.humidity_ratio.toFixed(6), si ? 'kg/kg' : 'lb/lb'],
    ['Humidity ratio', o.humidity_ratio_grains.toFixed(1), 'gr/lb'],
    ['Relative humidity  pᵥ/pᵥₛ', o.rh.toFixed(2), '%'],
    ['Degree of saturation  W/Wₛ', o.degree_of_saturation.toFixed(2), '%'],
    ['Enthalpy', o.enthalpy.toFixed(3), si ? 'kJ/kg' : 'Btu/lb'],
    ['Specific volume (dry-air basis)', o.specific_volume.toFixed(5), si ? 'm³/kg' : 'ft³/lb'],
    ['Moist-air density (reference only)', o.density.toFixed(5), si ? 'kg/m³' : 'lb/ft³'],
    ['Vapour pressure', o.vapor_pressure.toFixed(4), si ? 'kPa' : 'psi'],
    ['Barometric pressure', o.barometric_pressure.toFixed(4), si ? 'kPa' : 'psi'],
  ] as const;
}

/**
 * Temporary panel proving the Rust to TypeScript handshake end to end.
 *
 * Phase 4 replaces this with the real application shell; it exists so the
 * generated bindings are exercised by something a human can drive.
 */
export function DebugPanel() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<number>(InputState.DbtRh);
  const [dbt, setDbt] = useState('24');
  const [val2, setVal2] = useState('50');
  const [altitude, setAltitude] = useState('0');
  const [si, setSi] = useState(true);
  const [realGas, setRealGas] = useState(true);

  useEffect(() => {
    initEngine().then(
      () => setLoaded(true),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  let result: StatePointOutput | null = null;
  let error: string | null = null;
  if (loaded) {
    try {
      result = calculate_state(
        new StatePointInput(
          Number(dbt),
          Number(val2),
          mode as InputState,
          Number(altitude),
          si,
          realGas,
        ),
      );
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const active = MODES.find((m) => m.state === mode) ?? MODES[0];

  if (loadError) {
    return <p role="alert">Engine failed to load: {loadError}</p>;
  }

  return (
    <section style={{ display: 'grid', gap: '1rem', maxWidth: 560, margin: '2rem auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.15rem' }}>PsyPro</h1>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
          engine {loaded ? engine_version() : '…'}
        </span>
      </header>

      <div style={{ display: 'grid', gap: '0.6rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>Dry-bulb temperature ({si ? '°C' : '°F'})</span>
          <input value={dbt} onChange={(e) => setDbt(e.target.value)} inputMode="decimal" />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>Second known property</span>
          <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
            {MODES.map((m) => (
              <option key={m.label} value={m.state}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>
            {active.label} ({si ? active.si : active.ip})
          </span>
          <input value={val2} onChange={(e) => setVal2(e.target.value)} inputMode="decimal" />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>Altitude ({si ? 'm' : 'ft'})</span>
          <input
            value={altitude}
            onChange={(e) => setAltitude(e.target.value)}
            inputMode="decimal"
          />
        </label>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="checkbox" checked={si} onChange={(e) => setSi(e.target.checked)} />
          <span>SI units</span>
        </label>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={realGas}
            onChange={(e) => setRealGas(e.target.checked)}
          />
          <span>Real-gas enhancement factor (off = ideal gas, for teaching)</span>
        </label>
      </div>

      {error ? (
        <p role="alert" style={{ color: 'var(--chart-point)' }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows(result, si).map(([label, value, unit], i) => (
              <tr key={`${label}-${unit}`} style={{ background: i % 2 ? 'var(--color-surface)' : undefined }}>
                <td style={{ padding: '0.3rem 0.5rem', color: 'var(--color-text-muted)' }}>
                  {label}
                </td>
                <td
                  style={{
                    padding: '0.3rem 0.5rem',
                    textAlign: 'right',
                    fontFamily: 'var(--font-numeric)',
                  }}
                >
                  {value}
                </td>
                <td
                  style={{
                    padding: '0.3rem 0.5rem',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-numeric)',
                    fontSize: '0.8rem',
                  }}
                >
                  {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
