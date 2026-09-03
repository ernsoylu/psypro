import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no `ResizeObserver`, and the circuit editor measures its viewport
 * with one on mount.
 *
 * A stub rather than a polyfill: nothing under test depends on a resize being
 * *observed*, only on the constructor existing. A real implementation would
 * have to fake layout, which jsdom does not do either, so it would be a more
 * elaborate way of observing nothing.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;
