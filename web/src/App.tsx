import { DebugPanel } from './DebugPanel';

/**
 * Application shell.
 *
 * Phase 4 replaces this with the real top nav / toolbox / viewport / properties
 * layout. For now it hosts the engine debug panel.
 */
export function App() {
  return <DebugPanel />;
}
