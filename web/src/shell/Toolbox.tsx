/**
 * Left toolbox — the drawing tools above, the view controls below.
 *
 * The two groups are separated because they answer different questions: a tool
 * changes what a click *does*, a view control changes what you can *see*. They
 * are also the reason the divider is a real separator with a group label rather
 * than a decorative line — a screen reader has to be able to tell them apart
 * too.
 */

import { Icon, type IconName } from './Icon';
import { useT } from '../i18n/useT';
import type { TranslationKey } from '../i18n';

/** The tools that change what a pointer gesture means. */
export type ToolId = 'select' | 'addPoint' | 'drawProcess' | 'drawShape' | 'crosshair';

/** The view actions, which act once rather than changing a mode. */
export type ViewActionId = 'zoomIn' | 'zoomOut' | 'fitToWindow';

const TOOLS: { id: ToolId; icon: IconName; key: TranslationKey }[] = [
  { id: 'select', icon: 'select', key: 'tool.select' },
  { id: 'addPoint', icon: 'point', key: 'tool.addPoint' },
  { id: 'drawProcess', icon: 'process', key: 'tool.drawProcess' },
  { id: 'drawShape', icon: 'shape', key: 'tool.drawShape' },
  { id: 'crosshair', icon: 'crosshair', key: 'tool.crosshair' },
];

const VIEW_ACTIONS: { id: ViewActionId; icon: IconName; key: TranslationKey }[] = [
  { id: 'zoomIn', icon: 'zoomIn', key: 'tool.zoomIn' },
  { id: 'zoomOut', icon: 'zoomOut', key: 'tool.zoomOut' },
  { id: 'fitToWindow', icon: 'fit', key: 'tool.fitToWindow' },
];

/** What the toolbox needs from the application above it. */
export interface ToolboxProps {
  /** The tool a pointer gesture currently invokes. */
  activeTool: ToolId;
  /** Selects a tool. */
  onToolChange: (tool: ToolId) => void;
  /** Runs a view action. */
  onViewAction: (action: ViewActionId) => void;
  /** Whether the layers panel is open. */
  showLayers: boolean;
  /** Opens or closes the layers panel. */
  onToggleLayers: () => void;
}

export function Toolbox({
  activeTool,
  onToolChange,
  onViewAction,
  showLayers,
  onToggleLayers,
}: ToolboxProps) {
  const t = useT();

  return (
    <nav className="toolbox">
      <div className="toolbox__group" role="group" aria-label={t('tool.group.tools')}>
        {TOOLS.map(({ id, icon, key }) => (
          <button
            key={id}
            type="button"
            className="tool"
            aria-label={t(key)}
            title={t(key)}
            aria-pressed={activeTool === id}
            onClick={() => onToolChange(id)}
          >
            <Icon name={icon} size={19} />
          </button>
        ))}
      </div>

      <span className="rule rule--horizontal" />

      <div className="toolbox__group" role="group" aria-label={t('tool.group.view')}>
        <button
          type="button"
          className="tool"
          aria-label={t('tool.layers')}
          title={t('tool.layers')}
          aria-pressed={showLayers}
          onClick={onToggleLayers}
        >
          <Icon name="layers" size={17} />
        </button>
        {VIEW_ACTIONS.map(({ id, icon, key }) => (
          <button
            key={id}
            type="button"
            className="tool"
            aria-label={t(key)}
            title={t(key)}
            onClick={() => onViewAction(id)}
          >
            <Icon name={icon} size={17} />
          </button>
        ))}
      </div>
    </nav>
  );
}
