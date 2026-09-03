/**
 * The `.psy` project file.
 *
 * What a project *is*, on disk, is the same thing it is in memory: the inputs a
 * user supplied. Points are their two defining numbers, processes are what they
 * do, and the document settings are the three that invalidate everything else.
 * Nothing derived is written.
 *
 * That is not a space optimisation. A file carrying resolved properties would
 * be a file that disagrees with itself the moment the engine improves, and it
 * would be impossible to tell whether an old project's numbers were wrong or
 * merely old. Storing only inputs means a reopened project is *recomputed*, and
 * therefore right.
 *
 * # Versioning
 *
 * The `version` field is checked, not assumed. A newer file opened in an older
 * build is refused with a message rather than half-read: silently dropping
 * fields it does not recognise would lose a user's work without telling them.
 */

import { ChartLayout, InputState } from '../psychro';
import { derivesOutlet, type Process } from '../store/useProcessStore';
import { nextLabel, TYPED, type StatePoint } from '../store/usePsychStore';

/**
 * The format this build writes and can read.
 *
 * Version 2 admits **derived points**: a point may be placed by a process
 * rather than typed, and a process names the point it places. A version 1 file
 * has neither, so it is migrated on the way in — every point becomes typed, and
 * every process is given a freshly minted outlet point so an old document gains
 * the new behaviour instead of merely still opening.
 */
export const FORMAT_VERSION = 2;

/** The file's own identifier, so a stray JSON is refused early. */
export const FORMAT_MAGIC = 'psypro.project';

/** A saved project. */
export interface ProjectFile {
  /** Identifies the file as a PsyPro project. */
  magic: typeof FORMAT_MAGIC;
  /** The schema version, checked on open. */
  version: number;
  /** When it was written, ISO 8601. */
  savedAt: string;
  /** The engine that wrote it, for provenance (§12). */
  engine: string;
  /** Project name. */
  name: string;
  /** The three settings that invalidate every derived value. */
  document: {
    isSi: boolean;
    altitude: string;
    layout: ChartLayout;
    realGas: boolean;
  };
  /** State points, as their defining inputs. */
  points: StatePoint[];
  /** Processes, as what they do. */
  processes: Process[];
}

/** Everything a save needs from the application. */
export interface ProjectSnapshot {
  name: string;
  isSi: boolean;
  altitude: string;
  layout: ChartLayout;
  realGas: boolean;
  points: StatePoint[];
  processes: Process[];
}

/** Why a file could not be read as a project. */
export class ProjectFormatError extends Error {}

/** Serialises a project. */
export function serialise(snapshot: ProjectSnapshot, engine: string): string {
  const file: ProjectFile = {
    magic: FORMAT_MAGIC,
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    engine,
    name: snapshot.name,
    document: {
      isSi: snapshot.isSi,
      altitude: snapshot.altitude,
      layout: snapshot.layout,
      realGas: snapshot.realGas,
    },
    points: snapshot.points,
    processes: snapshot.processes,
  };
  // Two-space indent: a project file is a text file a user may reasonably open,
  // diff, or check into version control alongside their drawings.
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Gives every version 1 process the outlet point it never had.
 *
 * A version 1 process derived its outlet on the fly and drew an arrowhead there;
 * nothing in the document could refer to it. Minting the point on open is what
 * turns an old file into one whose train can be extended — and it is safe,
 * because the outlet's position is recomputed from the process either way. The
 * seed values are the inlet's, and they are the *dormant anchor*
 * `usePsychStore` describes: never read while the process places the point.
 *
 * Mutates both lists, which is why it is called once at the end of parsing
 * rather than woven through it.
 */
function migrateOutlets(points: StatePoint[], processes: Process[]): void {
  let minted = 0;
  for (const process of processes) {
    if (!derivesOutlet(process.kind) || process.toId) continue;
    const inlet = points.find((p) => p.id === process.fromId);
    if (!inlet) continue;

    minted += 1;
    const id = `pt-migrated-${minted}`;
    process.toId = id;
    points.push({
      id,
      label: nextLabel(points),
      dryBulb: inlet.dryBulb,
      mode: inlet.mode,
      secondValue: inlet.secondValue,
      source: { kind: 'outlet', processId: process.id },
    });
  }
}

/** Reads a number that must be present, or throws. */
function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectFormatError(`${field} is missing or is not a number`);
  }
  return value;
}

/**
 * Parses a project file.
 *
 * @throws {ProjectFormatError} when the file is not a project, is a newer
 * version than this build understands, or is missing a required field.
 */
export function deserialise(text: string): ProjectSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('the file is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectFormatError('the file is not a project');
  }
  const file = raw as Partial<ProjectFile>;

  if (file.magic !== FORMAT_MAGIC) {
    throw new ProjectFormatError('the file is not a PsyPro project');
  }
  if (typeof file.version !== 'number') {
    throw new ProjectFormatError('the file has no format version');
  }
  if (file.version > FORMAT_VERSION) {
    // Refused rather than half-read. Dropping fields this build does not
    // recognise would lose a user's work without telling them it had.
    throw new ProjectFormatError(
      `this project was written by a newer version of PsyPro (format ${file.version}; this build reads ${FORMAT_VERSION})`,
    );
  }

  const document = file.document;
  if (!document) throw new ProjectFormatError('the file has no document settings');

  const points: StatePoint[] = (file.points ?? []).map((p, i) => ({
    id: String(p.id ?? `pt-${i + 1}`),
    label: String(p.label ?? `P${i + 1}`),
    dryBulb: requireNumber(p.dryBulb, `point ${i + 1} dry bulb`),
    mode: requireNumber(p.mode, `point ${i + 1} input mode`) as InputState,
    secondValue: requireNumber(p.secondValue, `point ${i + 1} second value`),
    // A file that predates derived points has only typed ones, which is what
    // the fallback says rather than assumes.
    source: p.source?.kind === 'outlet' ? p.source : TYPED,
  }));

  // A process whose endpoints are not in the file is not a process. Dropping it
  // is better than opening a project that draws a line from nowhere.
  const ids = new Set(points.map((p) => p.id));
  const processes = (file.processes ?? [])
    .filter((p) => ids.has(p.fromId) && (p.secondId === null || ids.has(p.secondId)))
    .map((p) => ({ ...p, toId: p.toId ?? null }));

  // Only on the way up from version 1. A version 2 file already names the
  // point each process places, and re-running the migration on one would mint a
  // second outlet for any process that legitimately has none.
  if (file.version < FORMAT_VERSION) migrateOutlets(points, processes);

  return {
    name: String(file.name ?? ''),
    isSi: document.isSi !== false,
    altitude: String(document.altitude ?? '0'),
    layout: (document.layout ?? ChartLayout.Ashrae) as ChartLayout,
    realGas: document.realGas !== false,
    points,
    processes,
  };
}
