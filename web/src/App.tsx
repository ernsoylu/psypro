/**
 * Application shell placeholder.
 *
 * Phase 4 replaces this with the real top nav / toolbox / viewport / properties
 * layout. It exists now only so the scaffold renders something and the theme
 * variables are exercised end to end.
 */
export function App() {
  return (
    <main
      style={{
        display: 'grid',
        placeContent: 'center',
        height: '100%',
        gap: '0.5rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.25rem' }}>HDPsyChart</h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Scaffold only — see DEVELOPMENT_PLAN.md for the build order.
      </p>
    </main>
  );
}
