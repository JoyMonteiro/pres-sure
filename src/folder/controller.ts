// Glue between the folder session, the main store and the UI. Browser-only (window,
// IndexedDB, File System Access), so it is exercised by the manual checks, not unit tests.
import { useStore } from "../store/store";
import { debounce, exportJson, importJson, loadFolderHandle, saveFolderHandle } from "../store/persistence";
import { exportHtml } from "../export/exportHtml";
import { inlineAssets } from "../export/inline";
import type { ElementType, Presentation } from "../types";
import { registerAsset, setRegistryFolder } from "./assetRegistry";
import { DeckFolder } from "./deckFolder";
import { fsAccessFolder } from "./folderIO";
import { useFolderStore } from "./folderStore";

const FOLDER_SAVE_MS = 1000;

export const canOpenFolders = (): boolean => typeof window !== "undefined" && "showDirectoryPicker" in window;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

const typeFor = (f: File): ElementType =>
  f.type === "image/svg+xml" ? "svg" : f.type === "image/gif" ? "gif" : "image";

/** Replace the deck without leaving an undo step back into the previous project. */
function loadDeck(deck: Presentation) {
  useStore.getState().loadPresentation(deck);
  useStore.temporal.getState().clear();
}

function hasContent(p: Presentation) {
  return p.elements.length > 0 || p.frames.length > 0;
}

// --- Saving: one write at a time, and never into a folder other than the one scheduled. ---

let queue: Promise<void> = Promise.resolve();
const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn, fn));

/** Writes the latest deck; unless forced (Keep mine), only while the folder is open (never over a conflict). */
async function runSave(session: DeckFolder, force = false): Promise<void> {
  const { session: current, status } = useFolderStore.getState();
  if (current !== session) return; // folder switched or closed
  if (!force && status !== "open") return;
  const p = useStore.getState().presentation;
  useFolderStore.setState({ saving: "saving" });
  try {
    const r = await session.save(p, { force });
    if (useFolderStore.getState().session !== session) return;
    useFolderStore.setState(
      r === "conflict" ? { status: "conflict", saving: "idle" } : { status: "open", saving: "idle", error: null }
    );
  } catch (e) {
    useFolderStore.setState({ saving: "error", error: errorMessage(e) });
  }
}

const scheduleSave = debounce(
  (session: DeckFolder) => void enqueue(() => runSave(session)),
  FOLDER_SAVE_MS
);

let autosaveInstalled = false;
export function installFolderAutosave(): void {
  if (autosaveInstalled) return;
  autosaveInstalled = true;
  useStore.subscribe((state, prev) => {
    if (state.presentation === prev.presentation) return;
    const { session, status } = useFolderStore.getState();
    if (!session || status !== "open") return;
    useFolderStore.setState({ saving: "pending" });
    scheduleSave(session);
  });
}

// --- Opening, reopening, closing ---

async function attach(handle: FileSystemDirectoryHandle, isDirty: boolean): Promise<void> {
  const previous = useFolderStore.getState().session;
  let current = useStore.getState().presentation;
  // Moving to a different folder: flush pending edits, then carry the images along by embedding them.
  if (previous) {
    await enqueue(() => runSave(previous));
    current = await inlineAssets(useStore.getState().presentation, previous.io);
  }
  const session = new DeckFolder(fsAccessFolder(handle));
  const result = await session.open(current, {
    isDirty,
    confirmReplace: () =>
      window.confirm(
        `Replace the current project with the deck in “${handle.name}”?\n\n` +
          `Anything in the current project that you haven't saved with “Save .json” will be lost.`
      ),
  });
  if (result.kind === "cancelled") return;
  setRegistryFolder(session.io);
  // Set the session before loading, so the autosave subscription targets the new folder.
  useFolderStore.setState({ status: "open", name: handle.name, handle, session, saving: "idle", error: null });
  loadDeck(result.deck);
  await saveFolderHandle(handle);
}

export async function pickFolder(): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: "pres-sure-lecture", mode: "readwrite" });
  } catch {
    return; // picker cancelled
  }
  const isDirty = !useFolderStore.getState().session && hasContent(useStore.getState().presentation);
  try {
    await attach(handle, isDirty);
  } catch (e) {
    window.alert(`Couldn't open “${handle.name}”: ${errorMessage(e)}`);
  }
}

/** Boot: if a folder was open last time, show the reopen overlay. Returns whether one was. */
export async function restoreRememberedFolder(): Promise<boolean> {
  const handle = await loadFolderHandle().catch(() => null);
  if (!handle) return false;
  useFolderStore.setState({ status: "needsPermission", name: handle.name, handle });
  return true;
}

export async function reopenFolder(): Promise<void> {
  const { handle } = useFolderStore.getState();
  if (!handle) return;
  if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") return;
  try {
    await attach(handle, false); // disk wins over the IndexedDB copy (spec D8)
  } catch (e) {
    window.alert(`Couldn't reopen “${handle.name}”: ${errorMessage(e)}`);
  }
}

function detach() {
  setRegistryFolder(null);
  useFolderStore.setState({ status: "none", name: null, handle: null, session: null, saving: "idle", error: null });
}

/** From the reopen overlay: drop the folder without access to it (path images show as missing). */
export async function forgetFolder(): Promise<void> {
  detach();
  await saveFolderHandle(null);
}

/** From the toolbar: re-embed the images, then leave folder mode. */
export async function closeFolder(): Promise<void> {
  const { session } = useFolderStore.getState();
  if (!session) return;
  await enqueue(() => runSave(session)); // flush edits still waiting on the debounce
  const embedded = await inlineAssets(useStore.getState().presentation, session.io);
  detach();
  loadDeck(embedded);
  await saveFolderHandle(null);
}

// --- Toolbar actions that behave differently in folder mode ---

export async function addImageFiles(files: File[]): Promise<void> {
  const { addElement } = useStore.getState();
  for (const f of files) {
    const { session } = useFolderStore.getState();
    if (!session) {
      addElement(typeFor(f), await fileToDataUrl(f));
      continue;
    }
    try {
      const path = await session.addAsset(f); // file is on disk before the element exists
      registerAsset(path, f);
      addElement(typeFor(f), path);
    } catch (e) {
      useFolderStore.setState({ saving: "error", error: `Couldn't add ${f.name}: ${errorMessage(e)}` });
    }
  }
}

export async function importDeckFile(file: File): Promise<void> {
  const deck = await importJson(file);
  const { session } = useFolderStore.getState();
  useStore.getState().loadPresentation(session ? await session.importEmbedded(deck) : deck);
}

async function portable(): Promise<Presentation> {
  const p = useStore.getState().presentation;
  const { session } = useFolderStore.getState();
  return session ? inlineAssets(p, session.io) : p;
}

export async function downloadJson(): Promise<void> {
  exportJson(await portable());
}

export async function downloadHtml(): Promise<void> {
  exportHtml(await portable());
}

// --- Conflicts (spec D10) ---

export async function resolveConflict(choice: "disk" | "mine"): Promise<void> {
  const { session } = useFolderStore.getState();
  if (!session) return;
  if (choice === "mine") {
    useFolderStore.setState({ status: "open" });
    await enqueue(() => runSave(session, true));
    return;
  }
  // Through the queue, so a running save can't overlap the reload.
  await enqueue(async () => {
    try {
      const deck = await session.reload();
      setRegistryFolder(session.io); // images may have changed on disk too
      useFolderStore.setState({ status: "open", error: null });
      loadDeck(deck);
    } catch (e) {
      window.alert(`Couldn't load from disk: ${errorMessage(e)}`);
    }
  });
}

/** Focus/visibility check — catches a git pull made while the tab was in the background. */
export async function checkForExternalChange(): Promise<void> {
  // Through the queue, so it never races a save that is between writing and recording.
  await enqueue(async () => {
    const { session, status } = useFolderStore.getState();
    if (!session || status !== "open") return;
    try {
      if (await session.checkExternalChange()) useFolderStore.setState({ status: "conflict" });
    } catch {
      // A transient read failure; the next save re-checks.
    }
  });
}
