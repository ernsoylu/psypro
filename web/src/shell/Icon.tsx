/**
 * The icon set, as inline SVG paths.
 *
 * Inline rather than a sprite or an icon package: the whole set is under a
 * kilobyte, `currentColor` makes every icon theme-aware for free, and it keeps
 * the dependency list — which the licence policy in `CLAUDE.md` makes a
 * standing question — one entry shorter.
 *
 * All paths are drawn in a 24x24 box with a 1.75 stroke, so they sit on the
 * same optical weight as the UI type.
 */

/** Every icon the shell can draw. */
export type IconName =
  | 'mark'
  | 'save'
  | 'open'
  | 'export'
  | 'elevation'
  | 'sun'
  | 'moon'
  | 'select'
  | 'point'
  | 'process'
  | 'shape'
  | 'crosshair'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'menu'
  | 'trash'
  | 'layers'
  | 'learn';

const PATHS: Record<IconName, string> = {
  // A saturation curve rising to the right, which is the one shape that says
  // "psychrometric chart" without any text.
  mark: 'M3 20h18M3 20V4M4 19C9 19 15 15 19 5',
  save: 'M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3',
  open: 'M3 6h6l2 2h10v11H3z',
  export: 'M12 14V3m0 0 4 4m-4-4L8 7M4 14v6h16v-6',
  elevation: 'M2 19h20L14 6l-4 6-2-2z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  moon: 'M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10',
  select: 'M5 3l7 17 2.5-6.5L21 11z',
  point: 'M12 4v16M4 12h16M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  process: 'M4 18 20 6m0 0h-6m6 0v6',
  shape: 'M4 5h16v14H4z',
  crosshair: 'M12 3v6m0 6v6M3 12h6m6 0h6',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  trash: 'M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  learn:
    'M12 7C10 5.5 7 5 4 5.5v12C7 17 10 17.5 12 19c2-1.5 5-2 8-1.5v-12C17 5 14 5.5 12 7m0 0v12',
};

/**
 * Renders an icon.
 *
 * `aria-hidden` throughout: an icon here is always paired with a label or an
 * `aria-label` on the control that owns it, so announcing it again would read
 * the same thing twice.
 */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
