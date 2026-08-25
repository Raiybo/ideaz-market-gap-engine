"use client";

/**
 * Writing saved angles into a folder the user picked.
 *
 * A page served from a website cannot reach the filesystem, and should not be
 * able to. The File System Access API is the sanctioned exception: the user
 * chooses one directory, explicitly, and the page can write inside that
 * directory and nowhere else. The handle survives in IndexedDB, so the picker
 * appears once rather than on every save.
 *
 * Chrome and Edge on the desktop implement it. Firefox and Safari do not, and
 * there is no polyfill that could — the capability is the browser's to grant.
 * Those browsers fall back to an ordinary download, which lands in the
 * downloads folder and has to be moved by hand. That is worse, and it is the
 * whole of what is possible there, so the UI says which one is in play rather
 * than pretending the outcome is the same.
 */

const DB_NAME = "ideaz-export";
const STORE = "handles";
const HANDLE_KEY = "root";

/** Permission methods are part of the spec but not yet in lib.dom. */
type PermissionState = "granted" | "denied" | "prompt";
interface PermissionCapableHandle extends FileSystemDirectoryHandle {
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
interface PickerWindow {
  showDirectoryPicker?(options?: {
    mode?: "read" | "readwrite";
    startIn?: string;
    id?: string;
  }): Promise<FileSystemDirectoryHandle>;
}

export function folderApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as PickerWindow).showDirectoryPicker === "function"
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () =>
        resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Losing the handle costs one extra picker prompt, nothing more.
  }
}

export async function forgetFolder(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(HANDLE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/**
 * The remembered folder, if one was ever chosen.
 *
 * Returned even when permission has lapsed to "prompt": re-granting needs a
 * user gesture, so the decision belongs to the click handler, not here. Only a
 * handle that was never stored comes back null, and that is the case that has
 * to open the picker.
 */
export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  return ((await idbGet()) as PermissionCapableHandle | null) ?? null;
}

/**
 * Opens the picker. Must be called from a click: the browser refuses both the
 * picker and a permission prompt outside a user gesture.
 */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker.call(window, {
      mode: "readwrite",
      startIn: "desktop",
      id: "ideaz-detail",
    });
    await idbPut(handle);
    return handle;
  } catch {
    // The user dismissed the picker. Not an error worth reporting.
    return null;
  }
}

async function ensureWritable(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const h = handle as PermissionCapableHandle;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
}

export type SaveOutcome =
  | { status: "written"; folder: string; files: string[] }
  | { status: "downloaded"; files: string[] }
  | { status: "denied" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Writes one subfolder of files, asking for a directory only if none is held.
 * Every angle gets its own subfolder so two of them can later be read side by
 * side without their parts being confused for each other.
 */
export async function saveAngle(
  folderName: string,
  files: Record<string, string>,
): Promise<SaveOutcome> {
  if (!folderApiSupported()) {
    for (const [name, body] of Object.entries(files)) {
      downloadFile(`${folderName}--${name}`, body);
    }
    return { status: "downloaded", files: Object.keys(files) };
  }

  let root = await rememberedFolder();
  if (!root) {
    root = await chooseFolder();
    if (!root) return { status: "cancelled" };
  }

  if (!(await ensureWritable(root))) return { status: "denied" };

  try {
    const sub = await root.getDirectoryHandle(folderName, { create: true });
    for (const [name, body] of Object.entries(files)) {
      const file = await sub.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(body);
      await writable.close();
    }
    return { status: "written", folder: folderName, files: Object.keys(files) };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Write failed.",
    };
  }
}

export function downloadFile(filename: string, body: string): void {
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
