// The I/O seam for a lecture folder (spec §4). Everything above this interface is tested
// against memoryFolder(); fsAccessFolder() is the thin Chromium-only implementation.
import { mimeFromName } from "./dataUrl";

export const DECK_FILE = "deck.pressure.json";
export const PLAYER_FILE = "index.html";
export const ASSET_DIR = "assets";

export interface FolderIO {
  /** The folder's display name. */
  name: string;
  readText(path: string): Promise<{ text: string; lastModified: number } | null>;
  readBlob(path: string): Promise<Blob | null>;
  write(path: string, data: Blob | string): Promise<{ lastModified: number }>;
  /** File names directly inside `dir` ("" = the folder itself); [] if `dir` is missing. */
  list(dir: string): Promise<string[]>;
  lastModified(path: string): Promise<number | null>;
}

/** Split a folder-relative path into segments; null for empty paths or `.`/`..` traversal. */
export function splitPath(path: string): string[] | null {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) return null;
  return parts;
}

export interface MemoryFolder extends FolderIO {
  files: Map<string, { data: Blob; lastModified: number }>;
}

/** In-memory FolderIO for tests. lastModified is a counter that increases on every write. */
export function memoryFolder(name = "test-folder", initial: Record<string, Blob | string> = {}): MemoryFolder {
  let clock = 0;
  const files = new Map<string, { data: Blob; lastModified: number }>();
  const toBlob = (data: Blob | string, path: string) =>
    typeof data === "string" ? new Blob([data], { type: mimeFromName(path) }) : data;
  for (const [path, data] of Object.entries(initial)) files.set(path, { data: toBlob(data, path), lastModified: ++clock });

  return {
    name,
    files,
    async readText(path) {
      const f = files.get(path);
      return f ? { text: await f.data.text(), lastModified: f.lastModified } : null;
    },
    async readBlob(path) {
      return files.get(path)?.data ?? null;
    },
    async write(path, data) {
      const lastModified = ++clock;
      files.set(path, { data: toBlob(data, path), lastModified });
      return { lastModified };
    },
    async list(dir) {
      const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length));
    },
    async lastModified(path) {
      return files.get(path)?.lastModified ?? null;
    },
  };
}

/** FolderIO over a real directory picked with window.showDirectoryPicker(). */
export function fsAccessFolder(root: FileSystemDirectoryHandle): FolderIO {
  async function dirFor(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = root;
    for (const p of parts) {
      try {
        dir = await dir.getDirectoryHandle(p, { create });
      } catch {
        return null;
      }
    }
    return dir;
  }

  async function fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = splitPath(path);
    if (!parts) return null;
    const dir = await dirFor(parts.slice(0, -1), create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(parts[parts.length - 1], { create });
    } catch {
      return null;
    }
  }

  async function getFile(path: string): Promise<File | null> {
    const h = await fileHandle(path, false);
    return h ? h.getFile() : null;
  }

  return {
    name: root.name,
    async readText(path) {
      const f = await getFile(path);
      return f ? { text: await f.text(), lastModified: f.lastModified } : null;
    },
    readBlob: getFile,
    async write(path, data) {
      const h = await fileHandle(path, true);
      if (!h) throw new Error(`Cannot write ${path}`);
      const w = await h.createWritable();
      await w.write(data);
      await w.close();
      return { lastModified: (await h.getFile()).lastModified };
    },
    async list(dirPath) {
      const parts = dirPath ? splitPath(dirPath) : [];
      if (!parts) return [];
      const dir = await dirFor(parts, false);
      if (!dir) return [];
      const names: string[] = [];
      for await (const [name, h] of dir.entries()) if (h.kind === "file") names.push(name);
      return names;
    },
    async lastModified(path) {
      const f = await getFile(path);
      return f ? f.lastModified : null;
    },
  };
}
