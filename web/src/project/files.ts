/**
 * Saving and opening files.
 *
 * The File System Access API where it exists, and a download where it does not.
 * That fallback is not a nicety: Firefox and Safari do not implement
 * `showSaveFilePicker`, and §12 asks for the fallback explicitly. Without it the
 * Save button would be inert for a large share of users, and inert in a way that
 * looks like a bug rather than a missing browser feature.
 *
 * The difference a user notices is that the API path saves *back to the same
 * file* on a second save, and the fallback downloads a new copy each time. That
 * is worth having where it works.
 */

/**
 * The File System Access surface this module uses.
 *
 * Declared here rather than pulled from a types package: two methods and one
 * handle shape is the whole dependency, and the API is still not in the DOM
 * lib because it is not implemented everywhere — which is precisely the fact the
 * fallback below exists for.
 */
interface FilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface WritableFile {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

/** A handle to a file that can be saved to again, where the browser has them. */
export interface FileSystemHandle {
  createWritable: () => Promise<WritableFile>;
  getFile: () => Promise<File>;
}

/** A handle, or null when the browser gave a download instead. */
export type FileHandle = FileSystemHandle | null;

interface FilePickerWindow {
  showSaveFilePicker?: (options: FilePickerOptions) => Promise<FileSystemHandle>;
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemHandle[]>;
}

/** The window, narrowed to the picker methods that may or may not be there. */
function pickers(): FilePickerWindow {
  return window as unknown as FilePickerWindow;
}

/** Whether this browser can save back to a chosen file. */
export function canSaveInPlace(): boolean {
  return typeof window !== 'undefined' && pickers().showSaveFilePicker !== undefined;
}

/** The picker options for a project file. */
const PROJECT_PICKER = {
  suggestedName: 'project.psy',
  types: [
    {
      description: 'PsyPro project',
      accept: { 'application/json': ['.psy', '.json'] as string[] },
    },
  ],
};

/**
 * Writes text to disk, saving in place when the browser allows it.
 *
 * Returns the handle to save to next time, or null when the download fallback
 * was used — a downloaded file has no handle to write back to.
 */
export async function saveText(
  text: string,
  filename: string,
  existing: FileHandle,
  mime = 'application/json',
): Promise<FileHandle> {
  const showSave = pickers().showSaveFilePicker;
  if (showSave) {
    const handle =
      existing ?? (await showSave({ ...PROJECT_PICKER, suggestedName: filename }));
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return handle;
  }

  download(text, filename, mime);
  return null;
}

/**
 * Hands the user a file the browser downloads.
 *
 * The object URL is revoked on the next frame rather than immediately: revoking
 * it in the same task cancels the download in some browsers, which is a bug that
 * only appears on the browsers the fallback exists for.
 */
export function download(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Opens a file, through the picker where available and an input where not. */
export async function openText(): Promise<{ text: string; handle: FileHandle } | null> {
  const showOpen = pickers().showOpenFilePicker;
  if (showOpen) {
    const [handle] = await showOpen(PROJECT_PICKER);
    if (!handle) return null;
    const file = await handle.getFile();
    return { text: await file.text(), handle };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.psy,.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      // No handle: a file chosen through an <input> cannot be written back to,
      // so a later save has to go through the download path.
      file.text().then((text) => resolve({ text, handle: null }));
    });
    input.click();
  });
}
