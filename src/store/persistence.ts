// Autosave to IndexedDB + JSON import/export (§2.4).
import type { Presentation } from "../types";

const DB_NAME = "pres-sure";
const STORE = "presentations";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocal(p: Presentation): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(p, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLocal(): Promise<Presentation | null> {
  const db = await openDb();
  const result = await new Promise<Presentation | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Presentation) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

/** Debounce helper for autosave. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function exportJson(p: Presentation): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${slug(p.title)}.pressure.json`);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "presentation";
}

export async function importJson(file: File): Promise<Presentation> {
  const text = await file.text();
  return JSON.parse(text) as Presentation;
}

const FOLDER_KEY = "folder";
const FOLDER_STAMP_KEY = "folderStamp";

/** Run one request against the presentations store and resolve with its result. */
async function idbRequest<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Remember (or, with null, forget) the open lecture folder across reloads. */
export async function saveFolderHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  if (handle) await idbRequest("readwrite", (s) => s.put(handle, FOLDER_KEY));
  else await idbRequest("readwrite", (s) => s.delete(FOLDER_KEY));
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h = await idbRequest<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(FOLDER_KEY));
  return h ?? null;
}

/** When the open folder's deck was last written by us (DeckFolder.modified), for resuming after a reload. */
export async function saveFolderStamp(modified: number | null): Promise<void> {
  await idbRequest("readwrite", (s) => s.put(modified, FOLDER_STAMP_KEY));
}

export async function loadFolderStamp(): Promise<number | null> {
  const m = await idbRequest<number | null | undefined>("readonly", (s) => s.get(FOLDER_STAMP_KEY));
  return m ?? null;
}
