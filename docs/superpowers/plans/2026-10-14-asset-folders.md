# Lecture Folders & Assets by Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Chrome/Edge, let the editor open a lecture folder, store added images as files in `<folder>/assets/` referenced by relative path, and continuously write `deck.pressure.json` + `index.html` there so the folder is always ready to `git push` to GitHub Pages.

**Architecture:** `Element.content` keeps meaning "whatever goes in `<img src>`"; in folder mode it holds a relative path like `assets/keeling-curve.png`. All folder logic sits in `src/folder/`, layered on a small `FolderIO` interface with an in-memory fake, so everything except the thin browser/React glue is unit-tested in Node. A module-level asset registry resolves paths to `blob:` URLs at render time; `ElementBody` is the single image render site, so editor, thumbnails, player and presenter all inherit it. The export runtime is untouched — relative `<img src>` just works next to `index.html`.

**Tech Stack:** React 18 + TypeScript 5.9 + Vite 6, Zustand 5 (+ immer, zundo), Vitest 4 in Node (no jsdom), File System Access API (Chromium only).

**Spec:** `docs/superpowers/specs/2026-10-14-asset-folders-design.md` — read it first; decisions are cited below as D1–D10.

## Global Constraints

- **`src/export/runtime.ts` must not be modified.** Relative paths resolve against `index.html` on their own (spec §4 "Export runtime").
- **`src/types.ts` must not be modified.** No new fields on `Element` or `Presentation` (D4).
- **No new npm dependencies.**
- **Tests run in Node with no DOM** (`npm test` = `vitest run`). Any module with a test must not import React, `src/store/store.ts`, or `src/folder/controller.ts` (the store's autosave touches IndexedDB at import-adjacent time). Node 22 provides `Blob`, `File`, `crypto.subtle`, `atob`/`btoa` and `URL.createObjectURL` globally — use those.
- **File names are fixed:** deck `deck.pressure.json`, player `index.html`, asset directory `assets` — use the `DECK_FILE` / `PLAYER_FILE` / `ASSET_DIR` constants from Task 2, never string literals elsewhere.
- **`http:` / `https:` contents are never fetched, downloaded or copied** (D5).
- **The editor never deletes a file** in the lecture folder (D9).
- **Folder save debounce is 1000 ms**; the existing IndexedDB autosave (500 ms, `store.ts`) stays exactly as is (D2).
- Before every commit run `npm run typecheck && npm test`; both must pass.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (shown once in Task 1; repeat it in every commit).

## Review Focus

1. **Text elements must never be treated as asset paths.** A text box's `content` is HTML like `New text`, which is not `data:`/`http:`/`blob:`; it must never be looked up in the registry, migrated or inlined. Pinned in Task 3 (migrate/inline skip text whose content looks like a path) and Task 4 (`ElementBody` passes `null` for text).
2. **Placeholder images must not set `naturalW`/`naturalH`.** While an asset loads, `<img>` shows a 400×300 placeholder; its `onLoad` must not write the placeholder's size into the deck. Pinned in Task 4 (`isPlaceholderSrc` test + guard in `ElementBody`).
3. **Backspace/Delete/⌘Z behind the "Reopen folder" overlay must do nothing.** The overlay is the read-only mechanism; the global keyboard handler in `App.tsx` must respect it. Pinned in Task 6 (`isEditingLocked` test) and Task 7 (guard).
4. **Opening a folder that holds an `index.html` but no deck must not overwrite it** (e.g. an old reveal.js lecture). Pinned in Task 5.
5. **A malformed `deck.pressure.json` must be neither loaded nor overwritten.** Pinned in Task 5.

---

### Task 1: Pure helpers — data URIs and asset names

**Files:**
- Create: `src/folder/dataUrl.ts`
- Create: `src/folder/assetNames.ts`
- Test: `src/folder/dataUrl.test.ts`
- Test: `src/folder/assetNames.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mimeFromName(name: string): string`
  - `dataUrlToBlob(url: string): Blob`
  - `blobToDataUrl(blob: Blob, nameHint?: string): Promise<string>`
  - `isAssetPath(content: string): boolean`
  - `sanitizeName(filename: string, mime: string): string`
  - `chooseAssetName(desired: string, hash: string, existing: ReadonlyMap<string, string>): { name: string; reused: boolean }` — `existing` maps file name (no directory) → SHA-256 hex
  - `sha256Hex(data: Blob | ArrayBuffer): Promise<string>`

- [x] **Step 1: Write the failing tests**

`src/folder/dataUrl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blobToDataUrl, dataUrlToBlob, mimeFromName } from "./dataUrl";

describe("mimeFromName", () => {
  it("maps known image extensions case-insensitively", () => {
    expect(mimeFromName("assets/Map.SVG")).toBe("image/svg+xml");
    expect(mimeFromName("a.jpeg")).toBe("image/jpeg");
    expect(mimeFromName("a.jpg")).toBe("image/jpeg");
    expect(mimeFromName("a.png")).toBe("image/png");
    expect(mimeFromName("a.webp")).toBe("image/webp");
    expect(mimeFromName("a.gif")).toBe("image/gif");
  });
  it("falls back to octet-stream", () => {
    expect(mimeFromName("deck.pressure.json")).toBe("application/octet-stream");
    expect(mimeFromName("noext")).toBe("application/octet-stream");
  });
});

describe("dataUrlToBlob / blobToDataUrl", () => {
  it("round-trips a base64 data URI exactly", async () => {
    const url = `data:image/png;base64,${btoa("hello")}`;
    const blob = dataUrlToBlob(url);
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("hello");
    expect(await blobToDataUrl(blob)).toBe(url);
  });
  it("decodes a percent-encoded (non-base64) data URI", async () => {
    const blob = dataUrlToBlob("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toBe("<svg/>");
  });
  it("uses the name hint when the blob has no type", async () => {
    expect(await blobToDataUrl(new Blob(["x"]), "assets/a.svg")).toMatch(/^data:image\/svg\+xml;base64,/);
  });
  it("survives inputs larger than one encoding chunk", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const back = dataUrlToBlob(await blobToDataUrl(new Blob([bytes], { type: "image/png" })));
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
  });
  it("rejects strings that are not data URIs", () => {
    expect(() => dataUrlToBlob("assets/a.png")).toThrow();
  });
});
```

`src/folder/assetNames.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseAssetName, isAssetPath, sanitizeName, sha256Hex } from "./assetNames";

describe("isAssetPath", () => {
  it("is true only for relative paths", () => {
    expect(isAssetPath("assets/a.png")).toBe(true);
    expect(isAssetPath("data:image/png;base64,AAAA")).toBe(false);
    expect(isAssetPath("https://upload.wikimedia.org/x.png")).toBe(false);
    expect(isAssetPath("http://example.org/x.png")).toBe(false);
    expect(isAssetPath("blob:http://localhost/123")).toBe(false);
    expect(isAssetPath("")).toBe(false);
  });
});

describe("sanitizeName", () => {
  it.each([
    ["Keeling Curve.PNG", "image/png", "keeling-curve.png"],
    ["Énergie bilan (2).jpg", "image/jpeg", "energie-bilan-2.jpg"],
    ["..", "image/png", "image.png"],
    [".png", "image/png", "image.png"],
    ["photo", "image/webp", "photo.webp"],
    ["", "image/gif", "image.gif"],
    ["fig", "application/x-unknown", "fig.bin"],
    ["C:\\Users\\me\\map.SVG", "image/svg+xml", "map.svg"],
    ["日本.png", "image/png", "image.png"],
    ["fig.1.final.png", "image/png", "fig.1.final.png"],
  ])("%s (%s) -> %s", (name, mime, expected) => {
    expect(sanitizeName(name, mime)).toBe(expected);
  });
  it("caps very long stems at 80 characters", () => {
    expect(sanitizeName(`${"a".repeat(200)}.png`, "image/png")).toBe(`${"a".repeat(80)}.png`);
  });
});

describe("chooseAssetName", () => {
  it("keeps the desired name when free", () => {
    expect(chooseAssetName("a.png", "h1", new Map())).toEqual({ name: "a.png", reused: false });
  });
  it("reuses any file with identical bytes, whatever its name", () => {
    const existing = new Map([["other.png", "h1"]]);
    expect(chooseAssetName("a.png", "h1", existing)).toEqual({ name: "other.png", reused: true });
  });
  it("suffixes -2, -3 on a name clash with different bytes", () => {
    const existing = new Map([
      ["a.png", "h1"],
      ["a-2.png", "h2"],
    ]);
    expect(chooseAssetName("a.png", "h3", existing)).toEqual({ name: "a-3.png", reused: false });
  });
});

describe("sha256Hex", () => {
  it("hashes blobs and buffers identically", async () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256Hex(new Blob(["abc"]))).toBe(expected);
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(expected);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/folder`
Expected: FAIL — cannot resolve `./dataUrl` / `./assetNames`.

- [x] **Step 3: Implement `src/folder/dataUrl.ts`**

```ts
// Data-URI <-> Blob conversion without FileReader, so it runs under Node in tests.

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function mimeFromName(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("Not a data URI");
  const params = url.slice(5, comma).split(";"); // e.g. ["image/png", "base64"]
  const mime = params[0] || "text/plain";
  const payload = url.slice(comma + 1);
  if (params.includes("base64")) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

export async function blobToDataUrl(blob: Blob, nameHint = ""): Promise<string> {
  const mime = blob.type || mimeFromName(nameHint);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // String.fromCharCode(...) has an argument-count limit, so encode in chunks.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
```

- [x] **Step 4: Implement `src/folder/assetNames.ts`**

```ts
// Asset naming (spec D6) and content classification (spec D5). Pure apart from hashing.

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const MAX_STEM = 80;

/** True when `content` is a path relative to the lecture folder (not data:, http(s):, blob:). */
export function isAssetPath(content: string): boolean {
  return content !== "" && !/^(data:|https?:|blob:)/i.test(content);
}

export function sanitizeName(filename: string, mime: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawStem = dot >= 0 ? base.slice(0, dot) : base;
  const rawExt = dot >= 0 ? base.slice(dot + 1) : "";
  const stem =
    rawStem
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, MAX_STEM) || "image";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || EXT_BY_MIME[mime.split(";")[0]] || "bin";
  return `${stem}.${ext}`;
}

export function chooseAssetName(
  desired: string,
  hash: string,
  existing: ReadonlyMap<string, string>
): { name: string; reused: boolean } {
  for (const [name, h] of existing) if (h === hash) return { name, reused: true };
  if (!existing.has(desired)) return { name: desired, reused: false };
  const dot = desired.lastIndexOf(".");
  const stem = dot >= 0 ? desired.slice(0, dot) : desired;
  const ext = dot >= 0 ? desired.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existing.has(candidate)) return { name: candidate, reused: false };
  }
}

export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/folder && npm run typecheck`
Expected: all PASS, typecheck clean. If the `".."` or `".png"` cases fail, re-check that the stem trim regex strips leading/trailing dots *and* dashes.

- [x] **Step 6: Commit**

```bash
git add src/folder/dataUrl.ts src/folder/dataUrl.test.ts src/folder/assetNames.ts src/folder/assetNames.test.ts
git commit -m "feat: add data-URI and asset-naming helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `FolderIO` — the I/O seam, its in-memory fake and the real File System Access implementation

**Files:**
- Create: `src/folder/fs-access.d.ts`
- Create: `src/folder/folderIO.ts`
- Test: `src/folder/folderIO.test.ts`

**Interfaces:**
- Consumes: `mimeFromName` (Task 1).
- Produces:
  - constants `DECK_FILE = "deck.pressure.json"`, `PLAYER_FILE = "index.html"`, `ASSET_DIR = "assets"`
  - `interface FolderIO { name: string; readText(path: string): Promise<{ text: string; lastModified: number } | null>; readBlob(path: string): Promise<Blob | null>; write(path: string, data: Blob | string): Promise<{ lastModified: number }>; list(dir: string): Promise<string[]>; lastModified(path: string): Promise<number | null>; }`
  - `splitPath(path: string): string[] | null`
  - `interface MemoryFolder extends FolderIO { files: Map<string, { data: Blob; lastModified: number }> }`
  - `memoryFolder(name?: string, initial?: Record<string, Blob | string>): MemoryFolder`
  - `fsAccessFolder(root: FileSystemDirectoryHandle): FolderIO`
  - Global type augmentations: `FileSystemHandle.queryPermission/requestPermission`, `FileSystemDirectoryHandle.entries()`, `Window.showDirectoryPicker`.

- [x] **Step 1: Write the failing test**

`src/folder/folderIO.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { memoryFolder, splitPath } from "./folderIO";

describe("splitPath", () => {
  it("splits relative paths and rejects traversal", () => {
    expect(splitPath("assets/a.png")).toEqual(["assets", "a.png"]);
    expect(splitPath("deck.pressure.json")).toEqual(["deck.pressure.json"]);
    expect(splitPath("../secret")).toBeNull();
    expect(splitPath("assets/./a.png")).toBeNull();
    expect(splitPath("")).toBeNull();
  });
});

describe("memoryFolder", () => {
  it("reads back what was written, with increasing lastModified", async () => {
    const io = memoryFolder("lec", { "notes.txt": "hi" });
    expect(io.name).toBe("lec");
    const before = await io.lastModified("notes.txt");
    const { lastModified } = await io.write("assets/a.png", new Blob(["A"], { type: "image/png" }));
    expect(lastModified).toBeGreaterThan(before!);
    expect(await (await io.readBlob("assets/a.png"))!.text()).toBe("A");
    expect((await io.readText("notes.txt"))!.text).toBe("hi");
  });
  it("returns null for missing files", async () => {
    const io = memoryFolder();
    expect(await io.readText("nope")).toBeNull();
    expect(await io.readBlob("nope")).toBeNull();
    expect(await io.lastModified("nope")).toBeNull();
  });
  it("lists only files directly inside a directory", async () => {
    const io = memoryFolder("x", { "a.txt": "1", "assets/b.png": "2", "assets/sub/c.png": "3" });
    expect((await io.list("assets")).sort()).toEqual(["b.png"]);
    expect(await io.list("")).toEqual(["a.txt"]);
    expect(await io.list("missing")).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/folder/folderIO.test.ts`
Expected: FAIL — cannot resolve `./folderIO`.

- [x] **Step 3: Add the missing File System Access types**

`src/folder/fs-access.d.ts` (a global declaration file — no `import`/`export`):

```ts
// File System Access API members that TypeScript's lib.dom does not ship (Chromium-only).
interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandle>;
}
```

- [x] **Step 4: Implement `src/folder/folderIO.ts`**

```ts
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
```

- [x] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/folder && npm run typecheck`
Expected: PASS, typecheck clean. If `tsc` complains about duplicate declarations of `entries` or `queryPermission`, your TypeScript lib already ships them — delete just the conflicting member from `fs-access.d.ts`, not the whole file.

- [x] **Step 6: Commit**

```bash
git add src/folder/fs-access.d.ts src/folder/folderIO.ts src/folder/folderIO.test.ts
git commit -m "feat: add FolderIO seam with in-memory and File System Access implementations"
```
(end the message with the Co-Authored-By trailer — see Global Constraints)

---

### Task 3: Migration (embedded → files) and inlining (files → embedded)

**Files:**
- Create: `src/folder/migrate.ts`
- Create: `src/export/inline.ts`
- Test: `src/folder/migrate.test.ts`

**Interfaces:**
- Consumes: `dataUrlToBlob`, `blobToDataUrl` (Task 1); `chooseAssetName`, `sanitizeName`, `sha256Hex`, `isAssetPath` (Task 1); `FolderIO`, `ASSET_DIR`, `memoryFolder` (Task 2).
- Produces:
  - `interface PendingFile { path: string; blob: Blob }`
  - `migrateEmbedded(p: Presentation, existing: ReadonlyMap<string, string>): Promise<{ deck: Presentation; files: PendingFile[]; names: Map<string, string> }>` — `names` is `existing` plus every newly chosen name → hash
  - `inlineAssets(p: Presentation, io: FolderIO): Promise<Presentation>`

- [x] **Step 1: Write the failing tests**

`src/folder/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Element, Presentation } from "../types";
import { migrateEmbedded } from "./migrate";
import { inlineAssets } from "../export/inline";
import { memoryFolder } from "./folderIO";
import { sha256Hex } from "./assetNames";
import { dataUrlToBlob } from "./dataUrl";

const deck = (elements: Element[]): Presentation => ({
  id: "p1",
  title: "T",
  createdAt: 0,
  updatedAt: 0,
  world: { backgroundColor: "#ffffff" },
  elements,
  frames: [],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
});
const el = (id: string, content: string, type: Element["type"] = "image"): Element => ({
  id, type, x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, content,
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
});

const A = `data:image/png;base64,${btoa("AAA")}`;
const C = `data:image/png;base64,${btoa("CCC")}`;
const B = `data:image/jpeg;base64,${btoa("BBB")}`;
const REMOTE = "https://upload.wikimedia.org/x.png";
// A text box whose HTML happens to look like a path must never be touched.
const TEXT_PATHLIKE = "assets/looks-like-a-path.png";

const mixed = () =>
  deck([el("e1", A), el("e2", C), el("e3", A), el("e4", B), el("r", REMOTE), el("t", TEXT_PATHLIKE, "text")]);

describe("migrateEmbedded", () => {
  it("writes one file per distinct image and points elements at them", async () => {
    const { deck: out, files } = await migrateEmbedded(mixed(), new Map());
    const content = Object.fromEntries(out.elements.map((e) => [e.id, e.content]));
    expect(content).toEqual({
      e1: "assets/image.png",
      e2: "assets/image-2.png",
      e3: "assets/image.png",
      e4: "assets/image.jpg",
      r: REMOTE,
      t: TEXT_PATHLIKE,
    });
    expect(files.map((f) => f.path)).toEqual(["assets/image.png", "assets/image-2.png", "assets/image.jpg"]);
    expect(await files[0].blob.text()).toBe("AAA");
  });

  it("does not mutate its input", async () => {
    const input = mixed();
    await migrateEmbedded(input, new Map());
    expect(input.elements[0].content).toBe(A);
  });

  it("is a no-op on an already-migrated deck", async () => {
    const first = await migrateEmbedded(mixed(), new Map());
    const second = await migrateEmbedded(first.deck, first.names);
    expect(second.files).toEqual([]);
    expect(second.deck).toEqual(first.deck);
  });

  it("reuses files already in the folder and avoids their names", async () => {
    const existing = new Map([
      ["image.png", await sha256Hex(dataUrlToBlob(A))], // same bytes as A
      ["image.jpg", "some-other-hash"], // name taken by different bytes
    ]);
    const { deck: out, files } = await migrateEmbedded(deck([el("e1", A), el("e4", B)]), existing);
    expect(out.elements.map((e) => e.content)).toEqual(["assets/image.png", "assets/image-2.jpg"]);
    expect(files.map((f) => f.path)).toEqual(["assets/image-2.jpg"]);
  });
});

describe("inlineAssets", () => {
  it("round-trips with migrateEmbedded", async () => {
    const original = mixed();
    const { deck: migrated, files } = await migrateEmbedded(original, new Map());
    const io = memoryFolder();
    for (const f of files) await io.write(f.path, f.blob);
    expect(await inlineAssets(migrated, io)).toEqual(original);
  });

  it("leaves a path in place when its file is missing", async () => {
    const p = deck([el("e1", "assets/gone.png")]);
    expect((await inlineAssets(p, memoryFolder())).elements[0].content).toBe("assets/gone.png");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/folder/migrate.test.ts`
Expected: FAIL — cannot resolve `./migrate`.

- [x] **Step 3: Implement `src/folder/migrate.ts`**

```ts
// Embedded deck -> folder deck (spec D7): data: URIs become files in assets/.
import type { Element, Presentation } from "../types";
import { chooseAssetName, sanitizeName, sha256Hex } from "./assetNames";
import { dataUrlToBlob } from "./dataUrl";
import { ASSET_DIR } from "./folderIO";

export interface PendingFile {
  path: string;
  blob: Blob;
}

export async function migrateEmbedded(
  p: Presentation,
  existing: ReadonlyMap<string, string>
): Promise<{ deck: Presentation; files: PendingFile[]; names: Map<string, string> }> {
  const names = new Map(existing);
  const files: PendingFile[] = [];
  const elements: Element[] = [];
  for (const el of p.elements) {
    if (el.type === "text" || !el.content.startsWith("data:")) {
      elements.push(el);
      continue;
    }
    const blob = dataUrlToBlob(el.content);
    const hash = await sha256Hex(blob);
    const { name, reused } = chooseAssetName(sanitizeName("", blob.type), hash, names);
    if (!reused) {
      names.set(name, hash);
      files.push({ path: `${ASSET_DIR}/${name}`, blob });
    }
    elements.push({ ...el, content: `${ASSET_DIR}/${name}` });
  }
  return { deck: { ...p, elements }, files, names };
}
```

- [x] **Step 4: Implement `src/export/inline.ts`**

```ts
// Folder deck -> embedded deck: the inverse of migrateEmbedded. Used so *Save .json* and
// *Export .html* stay portable, single-file downloads in folder mode (spec §4).
import type { Presentation } from "../types";
import { isAssetPath } from "../folder/assetNames";
import { blobToDataUrl } from "../folder/dataUrl";
import type { FolderIO } from "../folder/folderIO";

export async function inlineAssets(p: Presentation, io: FolderIO): Promise<Presentation> {
  const cache = new Map<string, string>();
  const elements = [];
  for (const el of p.elements) {
    if (el.type === "text" || !isAssetPath(el.content)) {
      elements.push(el);
      continue;
    }
    let url = cache.get(el.content);
    if (url === undefined) {
      const blob = await io.readBlob(el.content);
      // Missing on disk: keep the path; the player shows a broken image rather than failing.
      if (!blob) {
        elements.push(el);
        continue;
      }
      url = await blobToDataUrl(blob, el.content);
      cache.set(el.content, url);
    }
    elements.push({ ...el, content: url });
  }
  return { ...p, elements };
}
```

- [x] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/folder && npm run typecheck`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/folder/migrate.ts src/folder/migrate.test.ts src/export/inline.ts
git commit -m "feat: migrate embedded images to files and inline them back"
```
(with the Co-Authored-By trailer)

---

### Task 4: Asset registry and rendering paths in `ElementBody`

**Files:**
- Create: `src/folder/assetRegistry.ts`
- Create: `src/folder/useAssetSrc.ts`
- Modify: `src/components/ElementView.tsx` (imports; `ElementBody`, lines ~114–161)
- Test: `src/folder/assetRegistry.test.ts`

**Interfaces:**
- Consumes: `isAssetPath` (Task 1); `FolderIO`, `memoryFolder` (Task 2).
- Produces:
  - `LOADING_SRC: string`, `missingSrc(path: string): string`, `isPlaceholderSrc(src: string): boolean`
  - `resolveAssetSrc(content: string): string`
  - `setRegistryFolder(io: FolderIO | null): void`
  - `registerAsset(path: string, blob: Blob): void`
  - `subscribeRegistry(listener: () => void): () => void`, `registryVersion(): number`
  - `useAssetSrc(content: string | null): string | null` (React hook, in its own file so the registry stays React-free)

- [x] **Step 1: Write the failing test**

`src/folder/assetRegistry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOADING_SRC,
  isPlaceholderSrc,
  missingSrc,
  registerAsset,
  resolveAssetSrc,
  setRegistryFolder,
  subscribeRegistry,
} from "./assetRegistry";
import { memoryFolder } from "./folderIO";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => setRegistryFolder(null));

describe("resolveAssetSrc", () => {
  it("passes data:, http(s): and blob: through untouched", () => {
    for (const c of ["data:image/png;base64,AA", "https://x/y.png", "http://x/y.png", "blob:http://h/1"]) {
      expect(resolveAssetSrc(c)).toBe(c);
    }
  });

  it("shows a path as missing when no folder is open", () => {
    const src = resolveAssetSrc("assets/a.png");
    expect(src).toBe(missingSrc("assets/a.png"));
    expect(isPlaceholderSrc(src)).toBe(true);
  });

  it("loads a path from the folder, notifying subscribers", async () => {
    setRegistryFolder(memoryFolder("f", { "assets/a.png": new Blob(["A"], { type: "image/png" }) }));
    let calls = 0;
    const unsubscribe = subscribeRegistry(() => calls++);
    expect(resolveAssetSrc("assets/a.png")).toBe(LOADING_SRC);
    await flush();
    const src = resolveAssetSrc("assets/a.png");
    expect(src.startsWith("blob:")).toBe(true);
    expect(isPlaceholderSrc(src)).toBe(false);
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
  });

  it("marks a path missing when the file is absent", async () => {
    setRegistryFolder(memoryFolder("f"));
    resolveAssetSrc("assets/gone.png");
    await flush();
    expect(resolveAssetSrc("assets/gone.png")).toBe(missingSrc("assets/gone.png"));
  });

  it("serves registered assets immediately", () => {
    setRegistryFolder(memoryFolder("f"));
    registerAsset("assets/new.png", new Blob(["N"], { type: "image/png" }));
    expect(resolveAssetSrc("assets/new.png").startsWith("blob:")).toBe(true);
  });

  it("forgets everything when the folder changes", async () => {
    setRegistryFolder(memoryFolder("f", { "assets/a.png": "A" }));
    resolveAssetSrc("assets/a.png");
    await flush();
    setRegistryFolder(memoryFolder("g"));
    expect(resolveAssetSrc("assets/a.png")).toBe(LOADING_SRC);
  });
});

describe("isPlaceholderSrc", () => {
  it("recognises both placeholders and nothing else", () => {
    expect(isPlaceholderSrc(LOADING_SRC)).toBe(true);
    expect(isPlaceholderSrc(missingSrc("assets/x.png"))).toBe(true);
    expect(isPlaceholderSrc("blob:http://h/1")).toBe(false);
    expect(isPlaceholderSrc("data:image/png;base64,AA")).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/folder/assetRegistry.test.ts`
Expected: FAIL — cannot resolve `./assetRegistry`.

- [x] **Step 3: Implement `src/folder/assetRegistry.ts`**

```ts
// Path -> blob: URL registry (spec §4). Module-level, one per window: the editor and the
// presenter window each point it at the lecture folder. React-free; see useAssetSrc.ts.
import { isAssetPath } from "./assetNames";
import type { FolderIO } from "./folderIO";

type Entry = { state: "loading" } | { state: "ready"; url: string } | { state: "missing" };

const placeholders = new Set<string>();
const svgPlaceholder = (fill: string, label: string) => {
  const text = label
    ? `<text x="200" y="155" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">${label}</text>`
    : "";
  const src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="${fill}"/>${text}</svg>`
    );
  placeholders.add(src);
  return src;
};
const escapeXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const LOADING_SRC = svgPlaceholder("#d4d4d8", "");
export const missingSrc = (path: string): string => svgPlaceholder("#dc2626", `missing: ${escapeXml(path)}`);
/** True for the loading/missing placeholders — their pixel size must never reach the deck. */
export const isPlaceholderSrc = (src: string): boolean => placeholders.has(src);

let folder: FolderIO | null = null;
let entries = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version++;
  listeners.forEach((l) => l());
}

export function setRegistryFolder(io: FolderIO | null): void {
  for (const e of entries.values()) if (e.state === "ready") URL.revokeObjectURL(e.url);
  entries = new Map();
  folder = io;
  bump();
}

export function registerAsset(path: string, blob: Blob): void {
  const prev = entries.get(path);
  if (prev?.state === "ready") URL.revokeObjectURL(prev.url);
  entries.set(path, { state: "ready", url: URL.createObjectURL(blob) });
  bump();
}

export function resolveAssetSrc(content: string): string {
  if (!isAssetPath(content)) return content;
  if (!folder) return missingSrc(content);
  const e = entries.get(content);
  if (e?.state === "ready") return e.url;
  if (e?.state === "missing") return missingSrc(content);
  if (!e) load(folder, content);
  return LOADING_SRC;
}

function load(io: FolderIO, path: string) {
  entries.set(path, { state: "loading" });
  const settle = (entry: Entry) => {
    if (folder !== io) return; // folder switched while loading
    entries.set(path, entry);
    bump();
  };
  io.readBlob(path).then(
    (blob) => settle(blob ? { state: "ready", url: URL.createObjectURL(blob) } : { state: "missing" }),
    () => settle({ state: "missing" })
  );
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const registryVersion = (): number => version;
```

Note: `missingSrc` adds a new string to `placeholders` per distinct path; identical paths produce identical strings, so the set stays bounded by the number of missing paths.

- [x] **Step 4: Implement `src/folder/useAssetSrc.ts`**

```ts
import { useSyncExternalStore } from "react";
import { registryVersion, resolveAssetSrc, subscribeRegistry } from "./assetRegistry";

/** Resolve an element's content to an <img src>; re-renders when the asset finishes loading. */
export function useAssetSrc(content: string | null): string | null {
  useSyncExternalStore(subscribeRegistry, registryVersion);
  return content === null ? null : resolveAssetSrc(content);
}
```

- [x] **Step 5: Wire it into `ElementBody`**

In `src/components/ElementView.tsx`, add imports next to the existing ones:

```ts
import { useAssetSrc } from "../folder/useAssetSrc";
import { isPlaceholderSrc } from "../folder/assetRegistry";
```

In `function ElementBody`, directly after `const ref = useRef<HTMLDivElement>(null);`, add (hooks must run before the early `return` for text):

```ts
  // Text content is HTML, never an asset path — pass null so it is not looked up.
  const src = useAssetSrc(el.type === "text" ? null : el.content);
```

Replace the `<img … />` block at the end of `ElementBody`:

```tsx
  // image / gif / svg are all <img> sources.
  return (
    <img
      src={el.content}
      alt=""
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (!el.naturalW && img.naturalWidth) {
          update(el.id, { naturalW: img.naturalWidth, naturalH: img.naturalHeight });
        }
      }}
    />
  );
```

with:

```tsx
  // image / gif / svg are all <img> sources.
  return (
    <img
      src={src ?? ""}
      alt=""
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        // A placeholder's 400×300 must never be recorded as the asset's natural size.
        if (!el.naturalW && img.naturalWidth && src && !isPlaceholderSrc(src)) {
          update(el.id, { naturalW: img.naturalWidth, naturalH: img.naturalHeight });
        }
      }}
    />
  );
```

- [x] **Step 6: Run tests, typecheck, and smoke-test classic mode**

Run: `npm test && npm run typecheck`
Expected: PASS.

Then `npm run dev`, open http://localhost:5173, add a PNG with *+ Image*: it must still display (data URIs pass straight through). Stop the server.

- [x] **Step 7: Commit**

```bash
git add src/folder/assetRegistry.ts src/folder/assetRegistry.test.ts src/folder/useAssetSrc.ts src/components/ElementView.tsx
git commit -m "feat: resolve asset paths through a registry when rendering images"
```
(with the Co-Authored-By trailer)

---

### Task 5: `DeckFolder` — the open-folder session

**Files:**
- Create: `src/folder/deckFolder.ts`
- Test: `src/folder/deckFolder.test.ts`

**Interfaces:**
- Consumes: `FolderIO`, `DECK_FILE`, `PLAYER_FILE`, `ASSET_DIR`, `memoryFolder` (Task 2); `migrateEmbedded` (Task 3); `inlineAssets` (Task 3, tests only); `chooseAssetName`, `sanitizeName`, `sha256Hex` (Task 1); `buildHtml(p: Presentation): string` from existing `src/export/exportHtml.ts`.
- Produces:
  - `type OpenResult = { kind: "loaded"; deck: Presentation } | { kind: "adopted"; deck: Presentation } | { kind: "cancelled" }`
  - `type SaveResult = "saved" | "unchanged" | "conflict"`
  - `parseDeck(text: string): Presentation` (throws `Error` with a readable message)
  - `class DeckFolder { constructor(io: FolderIO); readonly io: FolderIO; get name(): string; open(current: Presentation, opts: { isDirty: boolean; confirmReplace: () => boolean | Promise<boolean> }): Promise<OpenResult>; importEmbedded(p: Presentation): Promise<Presentation>; addAsset(file: File): Promise<string>; save(p: Presentation, opts?: { force?: boolean }): Promise<SaveResult>; checkExternalChange(): Promise<boolean>; reload(): Promise<Presentation> }`

Note vs. spec §4: `open()` performs the adoption writes itself (assets, deck, player) instead of returning a `writes` list — one fewer step for callers to forget.

- [x] **Step 1: Write the failing test**

`src/folder/deckFolder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Element, Presentation } from "../types";
import { DeckFolder } from "./deckFolder";
import { DECK_FILE, PLAYER_FILE, memoryFolder } from "./folderIO";
import { inlineAssets } from "../export/inline";

const deck = (elements: Element[], title = "T"): Presentation => ({
  id: "p1",
  title,
  createdAt: 0,
  updatedAt: 0,
  world: { backgroundColor: "#ffffff" },
  elements,
  frames: [],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
});
const el = (id: string, content: string): Element => ({
  id, type: "image", x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, content,
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
});
const A = `data:image/png;base64,${btoa("AAA")}`;
const json = (p: Presentation) => JSON.stringify(p, null, 2);
const never = () => {
  throw new Error("confirmReplace should not be called");
};
const snapshot = (io: ReturnType<typeof memoryFolder>) =>
  new Map([...io.files].map(([k, v]) => [k, v.lastModified]));

describe("DeckFolder.open", () => {
  it("loads an existing deck without writing anything", async () => {
    const onDisk = deck([el("e1", "assets/a.png")], "On disk");
    const io = memoryFolder("lec", { [DECK_FILE]: json(onDisk), "assets/a.png": "A" });
    const before = snapshot(io);
    const r = await new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never });
    expect(r).toEqual({ kind: "loaded", deck: onDisk });
    expect(snapshot(io)).toEqual(before);
  });

  it("asks before replacing a dirty project, and respects the answer", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: json(deck([])) });
    const no = vi.fn(() => false);
    expect(await new DeckFolder(io).open(deck([el("e", A)]), { isDirty: true, confirmReplace: no })).toEqual({
      kind: "cancelled",
    });
    expect(no).toHaveBeenCalledOnce();
    const yes = vi.fn(async () => true);
    expect((await new DeckFolder(io).open(deck([el("e", A)]), { isDirty: true, confirmReplace: yes })).kind).toBe(
      "loaded"
    );
  });

  it("adopts the current project into an empty folder, moving images to assets/", async () => {
    const io = memoryFolder("lec");
    const r = await new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: true, confirmReplace: never });
    expect(r.kind).toBe("adopted");
    if (r.kind !== "adopted") return;
    expect(r.deck.elements[0].content).toBe("assets/image.png");
    expect(await (await io.readBlob("assets/image.png"))!.text()).toBe("AAA");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text)).toEqual(r.deck);
    const html = (await io.readText(PLAYER_FILE))!.text;
    expect(html).toContain("assets/image.png");
    expect(html).not.toContain("base64");
  });

  it("treats a folder with unrelated files as empty but never overwrites them", async () => {
    const io = memoryFolder("lec", { "notes.txt": "keep me", "assets/image.png": "other bytes" });
    const r = await new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: false, confirmReplace: never });
    if (r.kind !== "adopted") throw new Error(r.kind);
    expect(r.deck.elements[0].content).toBe("assets/image-2.png");
    expect((await io.readText("notes.txt"))!.text).toBe("keep me");
    expect((await io.readText("assets/image.png"))!.text).toBe("other bytes");
  });

  it("refuses a folder holding an index.html but no deck, writing nothing", async () => {
    const io = memoryFolder("old-reveal-lecture", { [PLAYER_FILE]: "<html>reveal.js</html>" });
    const before = snapshot(io);
    await expect(new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /index\.html/
    );
    expect(snapshot(io)).toEqual(before);
  });

  it("refuses a malformed deck, writing nothing", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: "{ not json" });
    const before = snapshot(io);
    await expect(new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /not valid JSON/
    );
    expect(snapshot(io)).toEqual(before);
  });

  it("refuses JSON that is not a deck", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: '{"hello": 1}' });
    await expect(new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /not a pres-sure deck/
    );
  });

  it("moves a folder deck into a new empty folder when inlined first", async () => {
    const a = memoryFolder("a", { "assets/a.png": new Blob(["AAA"], { type: "image/png" }) });
    const fromA = await inlineAssets(deck([el("e1", "assets/a.png")]), a);
    const b = memoryFolder("b");
    const r = await new DeckFolder(b).open(fromA, { isDirty: false, confirmReplace: never });
    if (r.kind !== "adopted") throw new Error(r.kind);
    const path = r.deck.elements[0].content;
    expect(await (await b.readBlob(path))!.text()).toBe("AAA");
  });
});

describe("DeckFolder.addAsset", () => {
  it("writes the file before returning its path", async () => {
    const io = memoryFolder("lec");
    const path = await new DeckFolder(io).addAsset(new File(["K"], "Keeling Curve.PNG", { type: "image/png" }));
    expect(path).toBe("assets/keeling-curve.png");
    expect(await (await io.readBlob(path))!.text()).toBe("K");
  });

  it("reuses identical bytes and suffixes clashing names", async () => {
    const io = memoryFolder("lec", { "assets/fig.png": new Blob(["X"], { type: "image/png" }) });
    const f = new DeckFolder(io);
    expect(await f.addAsset(new File(["X"], "copy.png", { type: "image/png" }))).toBe("assets/fig.png");
    expect(await f.addAsset(new File(["Y"], "fig.png", { type: "image/png" }))).toBe("assets/fig-2.png");
    expect(await f.addAsset(new File(["Y"], "again.png", { type: "image/png" }))).toBe("assets/fig-2.png");
  });
});

describe("DeckFolder.save", () => {
  const opened = async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: json(deck([])) });
    const f = new DeckFolder(io);
    await f.open(deck([]), { isDirty: false, confirmReplace: never });
    return { io, f };
  };

  it("skips the write when nothing changed", async () => {
    const { io, f } = await opened();
    const before = snapshot(io);
    expect(await f.save(deck([]))).toBe("unchanged");
    expect(snapshot(io)).toEqual(before);
  });

  it("writes the deck and the player when the deck changed", async () => {
    const { io, f } = await opened();
    const next = deck([el("e1", "assets/a.png")], "Changed");
    expect(await f.save(next)).toBe("saved");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text)).toEqual(next);
    expect((await io.readText(PLAYER_FILE))!.text).toContain("<title>Changed</title>");
  });

  it("reports a conflict and writes nothing after an external edit", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect(await f.checkExternalChange()).toBe(true);
    const before = snapshot(io);
    expect(await f.save(deck([], "Mine"))).toBe("conflict");
    expect(snapshot(io)).toEqual(before);
  });

  it("overwrites on force (Keep mine)", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect(await f.save(deck([], "Mine"), { force: true })).toBe("saved");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text).title).toBe("Mine");
    expect(await f.checkExternalChange()).toBe(false);
  });

  it("reload (Load from disk) returns the disk deck and clears the conflict", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect((await f.reload()).title).toBe("From git");
    expect(await f.checkExternalChange()).toBe(false);
    expect(await f.save(deck([], "From git"))).toBe("unchanged");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/folder/deckFolder.test.ts`
Expected: FAIL — cannot resolve `./deckFolder`.

- [x] **Step 3: Implement `src/folder/deckFolder.ts`**

```ts
// One open lecture folder (spec §4). No React, no store — the controller wires it up.
import type { Presentation } from "../types";
import { buildHtml } from "../export/exportHtml";
import { chooseAssetName, sanitizeName, sha256Hex } from "./assetNames";
import { ASSET_DIR, DECK_FILE, PLAYER_FILE, type FolderIO } from "./folderIO";
import { migrateEmbedded } from "./migrate";

export type OpenResult =
  | { kind: "loaded"; deck: Presentation }
  | { kind: "adopted"; deck: Presentation }
  | { kind: "cancelled" };

export type SaveResult = "saved" | "unchanged" | "conflict";

export function parseDeck(text: string): Presentation {
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error(`${DECK_FILE} is not valid JSON`);
  }
  const d = p as Presentation | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.elements) || !Array.isArray(d.frames)) {
    throw new Error(`${DECK_FILE} is not a pres-sure deck`);
  }
  return d;
}

export class DeckFolder {
  /** lastModified of DECK_FILE as of our last read or write (spec D8). */
  private knownModified: number | null = null;
  /** The exact text of DECK_FILE as of our last read or write — lets save() skip no-op writes. */
  private knownText: string | null = null;
  /** assets/ file name -> SHA-256, built lazily on first need. */
  private hashes: Map<string, string> | null = null;

  constructor(readonly io: FolderIO) {}

  get name(): string {
    return this.io.name;
  }

  async open(
    current: Presentation,
    opts: { isDirty: boolean; confirmReplace: () => boolean | Promise<boolean> }
  ): Promise<OpenResult> {
    const existing = await this.io.readText(DECK_FILE);
    if (existing) {
      const deck = parseDeck(existing.text); // throws before anything is written
      if (opts.isDirty && !(await opts.confirmReplace())) return { kind: "cancelled" };
      this.knownModified = existing.lastModified;
      this.knownText = existing.text;
      return { kind: "loaded", deck };
    }
    if ((await this.io.lastModified(PLAYER_FILE)) !== null) {
      throw new Error(
        `“${this.io.name}” already has an ${PLAYER_FILE} that pres-sure didn't create. ` +
          `Pick an empty folder or an existing pres-sure lecture folder.`
      );
    }
    const deck = await this.importEmbedded(current);
    await this.save(deck, { force: true });
    return { kind: "adopted", deck };
  }

  /** Write a deck's embedded images to assets/ and return it with paths (spec D7). */
  async importEmbedded(p: Presentation): Promise<Presentation> {
    const { deck, files, names } = await migrateEmbedded(p, await this.assetHashes());
    for (const f of files) await this.io.write(f.path, f.blob);
    this.hashes = names;
    return deck;
  }

  /** Store an added image in assets/ (spec D6). The file exists on disk before this resolves. */
  async addAsset(file: File): Promise<string> {
    const hashes = await this.assetHashes();
    const hash = await sha256Hex(file);
    const { name, reused } = chooseAssetName(sanitizeName(file.name, file.type), hash, hashes);
    const path = `${ASSET_DIR}/${name}`;
    if (!reused) {
      await this.io.write(path, file);
      hashes.set(name, hash);
    }
    return path;
  }

  async save(p: Presentation, opts: { force?: boolean } = {}): Promise<SaveResult> {
    if (!opts.force && (await this.checkExternalChange())) return "conflict";
    const text = JSON.stringify(p, null, 2);
    if (!opts.force && text === this.knownText) return "unchanged";
    await this.io.write(PLAYER_FILE, buildHtml(p));
    // The deck goes last, so knownModified always describes a fully written pair.
    const { lastModified } = await this.io.write(DECK_FILE, text);
    this.knownModified = lastModified;
    this.knownText = text;
    return "saved";
  }

  async checkExternalChange(): Promise<boolean> {
    return (await this.io.lastModified(DECK_FILE)) !== this.knownModified;
  }

  async reload(): Promise<Presentation> {
    const existing = await this.io.readText(DECK_FILE);
    if (!existing) throw new Error(`${DECK_FILE} is missing from “${this.io.name}”`);
    const deck = parseDeck(existing.text);
    this.knownModified = existing.lastModified;
    this.knownText = existing.text;
    return deck;
  }

  private async assetHashes(): Promise<Map<string, string>> {
    if (!this.hashes) {
      const m = new Map<string, string>();
      for (const name of await this.io.list(ASSET_DIR)) {
        const blob = await this.io.readBlob(`${ASSET_DIR}/${name}`);
        if (blob) m.set(name, await sha256Hex(blob));
      }
      this.hashes = m;
    }
    return this.hashes;
  }
}
```

- [x] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. If "loads an existing deck without writing anything" fails, check that `open()` does not call `save()` on the loaded path.

- [x] **Step 5: Commit**

```bash
git add src/folder/deckFolder.ts src/folder/deckFolder.test.ts
git commit -m "feat: add DeckFolder session with adopt, save and conflict detection"
```
(with the Co-Authored-By trailer)

---

### Task 6: Folder state, remembered handle, and the controller

**Files:**
- Create: `src/folder/folderStore.ts`
- Test: `src/folder/folderStore.test.ts`
- Modify: `src/store/persistence.ts` (append)
- Create: `src/folder/controller.ts`

**Interfaces:**
- Consumes: `DeckFolder` (Task 5); `fsAccessFolder` (Task 2); `registerAsset`, `setRegistryFolder` (Task 4); `inlineAssets` (Task 3); existing `useStore` (`loadPresentation`, `addElement`, `presentation`, `useStore.temporal`), `exportJson`, `importJson`, `debounce` from `src/store/persistence.ts`, `exportHtml` from `src/export/exportHtml.ts`.
- Produces:
  - `type FolderStatus = "none" | "needsPermission" | "open" | "conflict"`, `type SaveState = "idle" | "pending" | "saving" | "error"`
  - `useFolderStore` (zustand) with state `{ status, name: string | null, handle: FileSystemDirectoryHandle | null, session: DeckFolder | null, saving: SaveState, error: string | null }`
  - `isEditingLocked(): boolean`
  - `saveFolderHandle(handle: FileSystemDirectoryHandle | null): Promise<void>`, `loadFolderHandle(): Promise<FileSystemDirectoryHandle | null>`
  - controller: `canOpenFolders(): boolean`, `pickFolder()`, `restoreRememberedFolder(): Promise<boolean>`, `reopenFolder()`, `forgetFolder()`, `closeFolder()`, `addImageFiles(files: File[])`, `importDeckFile(file: File)`, `downloadJson()`, `downloadHtml()`, `resolveConflict(choice: "disk" | "mine")`, `checkForExternalChange()`, `installFolderAutosave(): void` — all async ones return `Promise<void>` unless stated.

- [x] **Step 1: Write the failing test**

`src/folder/folderStore.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { isEditingLocked, useFolderStore } from "./folderStore";

afterEach(() => useFolderStore.setState({ status: "none" }));

describe("isEditingLocked", () => {
  it("locks editing only while the reopen overlay is up", () => {
    for (const status of ["none", "open", "conflict"] as const) {
      useFolderStore.setState({ status });
      expect(isEditingLocked()).toBe(false);
    }
    useFolderStore.setState({ status: "needsPermission" });
    expect(isEditingLocked()).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/folder/folderStore.test.ts`
Expected: FAIL — cannot resolve `./folderStore`.

- [x] **Step 3: Implement `src/folder/folderStore.ts`**

Kept separate from `store.ts` so zundo never records folder status in undo history (spec §4).

```ts
import { create } from "zustand";
import type { DeckFolder } from "./deckFolder";

export type FolderStatus = "none" | "needsPermission" | "open" | "conflict";
export type SaveState = "idle" | "pending" | "saving" | "error";

interface FolderState {
  status: FolderStatus;
  name: string | null;
  handle: FileSystemDirectoryHandle | null;
  session: DeckFolder | null;
  saving: SaveState;
  error: string | null;
}

export const useFolderStore = create<FolderState>()(() => ({
  status: "none",
  name: null,
  handle: null,
  session: null,
  saving: "idle",
  error: null,
}));

/** While the reopen overlay is up, the canvas shows a read-only copy (spec §4 "Reopen overlay"). */
export const isEditingLocked = (): boolean => useFolderStore.getState().status === "needsPermission";
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/folder/folderStore.test.ts`
Expected: PASS.

- [x] **Step 5: Remember the folder handle in IndexedDB**

Append to `src/store/persistence.ts` (same object store, new key — no DB version bump):

```ts
const FOLDER_KEY = "folder";

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
```

- [x] **Step 6: Implement `src/folder/controller.ts`**

```ts
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

async function runSave(session: DeckFolder, p: Presentation, force = false): Promise<void> {
  if (useFolderStore.getState().session !== session) return; // folder switched or closed
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
  (session: DeckFolder, p: Presentation) => void enqueue(() => runSave(session, p)),
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
    scheduleSave(session, state.presentation);
  });
}

// --- Opening, reopening, closing ---

async function attach(handle: FileSystemDirectoryHandle, isDirty: boolean): Promise<void> {
  const previous = useFolderStore.getState().session;
  let current = useStore.getState().presentation;
  // Moving to a different folder: carry the images along by embedding them first.
  if (previous) current = await inlineAssets(current, previous.io);
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
    await enqueue(() => runSave(session, useStore.getState().presentation, true));
    return;
  }
  try {
    const deck = await session.reload();
    setRegistryFolder(session.io); // images may have changed on disk too
    useFolderStore.setState({ status: "open", error: null });
    loadDeck(deck);
  } catch (e) {
    window.alert(`Couldn't load from disk: ${errorMessage(e)}`);
  }
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
```

- [x] **Step 7: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS. (`controller.ts` is not imported anywhere yet; `noUnusedLocals` does not flag unused exports.)

- [x] **Step 8: Commit**

```bash
git add src/folder/folderStore.ts src/folder/folderStore.test.ts src/store/persistence.ts src/folder/controller.ts
git commit -m "feat: add folder state, remembered handle and folder controller"
```
(with the Co-Authored-By trailer)

---

### Task 7: Editor UI — toolbar chip, reopen overlay, conflict banner, focus check

**Files:**
- Create: `src/components/FolderUI.tsx`
- Modify: `src/components/Toolbar.tsx` (whole file below)
- Modify: `src/App.tsx` (imports, bootstrap effect, keyboard handler, new focus effect, render)
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: everything exported by `src/folder/controller.ts` and `src/folder/folderStore.ts` (Task 6).
- Produces: `FolderChip`, `FolderOverlay`, `ConflictBanner` React components.

- [x] **Step 1: Create `src/components/FolderUI.tsx`**

```tsx
import { useFolderStore } from "../folder/folderStore";
import {
  canOpenFolders,
  closeFolder,
  forgetFolder,
  pickFolder,
  reopenFolder,
  resolveConflict,
} from "../folder/controller";

/** Toolbar: "Open folder…" or the open folder's name and save state. */
export function FolderChip() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  const saving = useFolderStore((s) => s.saving);
  const error = useFolderStore((s) => s.error);

  if (status === "none" || status === "needsPermission") {
    if (!canOpenFolders()) return null;
    return (
      <button onClick={() => void pickFolder()} title="Keep this lecture in a folder, with images as separate files">
        📁 Open folder…
      </button>
    );
  }

  const label =
    status === "conflict"
      ? "conflict"
      : saving === "error"
        ? "error"
        : saving === "saving" || saving === "pending"
          ? "saving…"
          : "saved";
  const bad = label === "conflict" || label === "error";
  return (
    <span className={`folder-chip${bad ? " bad" : ""}`} title={error ?? `Saving to the folder “${name}”`}>
      📁 {name} · {label}
      <button className="chip-btn" onClick={() => void pickFolder()} title="Open a different folder">
        ⇄
      </button>
      <button className="chip-btn" onClick={() => void closeFolder()} title="Close the folder (images are embedded again)">
        ×
      </button>
    </span>
  );
}

/** Boot-time overlay: the remembered folder needs permission again (spec §4). */
export function FolderOverlay() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  if (status !== "needsPermission") return null;
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Reopen 📁 {name}?</h2>
        <p style={{ color: "var(--muted)" }}>
          Your browser needs permission again to edit this lecture folder. Until then, the canvas shows the last
          autosaved copy, read-only.
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={() => void reopenFolder()}>
            Reopen 📁 {name}
          </button>
          <button onClick={() => void forgetFolder()}>Forget folder</button>
        </div>
      </div>
    </div>
  );
}

/** Shown when deck.pressure.json changed on disk behind the editor's back (spec D10). */
export function ConflictBanner() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  if (status !== "conflict") return null;
  return (
    <div className="conflict-banner" role="alert">
      <span>
        <b>deck.pressure.json</b> in 📁 {name} changed outside the editor (git pull?). Saving is paused.
      </span>
      <button onClick={() => void resolveConflict("disk")}>Load from disk</button>
      <button onClick={() => void resolveConflict("mine")}>Keep mine</button>
    </div>
  );
}
```

- [x] **Step 2: Replace `src/components/Toolbar.tsx`**

Replace the whole file with (the asset/JSON/export logic moved into the controller; markup otherwise unchanged):

```tsx
import { useEffect, useReducer, useRef } from "react";
import { useStore } from "../store/store";
import { addImageFiles, downloadHtml, downloadJson, importDeckFile } from "../folder/controller";
import { FolderChip } from "./FolderUI";

function useTemporal() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => useStore.temporal.subscribe(() => force()), []);
  return useStore.temporal.getState();
}

export function Toolbar() {
  const title = useStore((s) => s.presentation.title);
  const setTitle = useStore((s) => s.setTitle);
  const addElement = useStore((s) => s.addElement);
  const setMode = useStore((s) => s.setMode);
  const temporal = useTemporal();
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const openPresenter = () => window.open(`${location.pathname}#presenter`, "pres-sure-presenter", "width=1100,height=720");

  return (
    <div className="toolbar">
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="sep" />
      <div className="group">
        <button onClick={() => addElement("text", "New text")}>+ Text</button>
        <button onClick={() => fileRef.current?.click()}>+ Image / GIF / SVG</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          hidden
          onChange={(e) => {
            // Copy the list before clearing the input — clearing empties the live FileList.
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addImageFiles(files);
          }}
        />
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={() => temporal.undo()} disabled={temporal.pastStates.length === 0} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={() => temporal.redo()} disabled={temporal.futureStates.length === 0} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        <FolderChip />
        <div className="sep" />
        <button onClick={() => jsonRef.current?.click()}>Import</button>
        <input
          ref={jsonRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importDeckFile(file);
          }}
        />
        <button onClick={() => void downloadJson()}>Save .json</button>
        <button onClick={() => void downloadHtml()}>Export .html</button>
        <div className="sep" />
        <button onClick={openPresenter} title="Open presenter view in a new window">
          Presenter
        </button>
        <button className="primary" onClick={() => setMode("play")}>
          ▶ Present
        </button>
      </div>
    </div>
  );
}
```

Before replacing, diff the current file against this version (`git diff --no-index` or by eye) and carry over anything in the current markup that is not shown here — the intent is to change only the asset, import and export handlers and to add `<FolderChip />`.

- [x] **Step 3: Update `src/App.tsx`**

Add imports:

```ts
import { ConflictBanner, FolderOverlay } from "./components/FolderUI";
import { checkForExternalChange, installFolderAutosave, restoreRememberedFolder } from "./folder/controller";
import { isEditingLocked } from "./folder/folderStore";
```

Replace the bootstrap effect:

```ts
  // Bootstrap: restore autosaved work, else offer a template.
  useEffect(() => {
    loadLocal().then((p) => {
      if (p && (p.elements.length || p.frames.length)) {
        loadPresentation(p);
      } else {
        setShowPicker(true);
      }
      setBooted(true);
    });
  }, [loadPresentation]);
```

with:

```ts
  // Bootstrap: restore autosaved work, else offer a template. A remembered lecture folder
  // shows the reopen overlay instead of the template picker.
  useEffect(() => {
    installFolderAutosave();
    (async () => {
      const p = await loadLocal();
      const remembered = await restoreRememberedFolder();
      if (p && (p.elements.length || p.frames.length)) {
        loadPresentation(p);
      } else if (!remembered) {
        setShowPicker(true);
      }
      setBooted(true);
    })();
  }, [loadPresentation]);

  // Returning to the tab after a git pull: check whether the deck changed on disk (spec D10).
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void checkForExternalChange();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
```

In the global keyboard handler, make the first line of `const onKey = (e: KeyboardEvent) => {` body:

```ts
      if (isEditingLocked()) return; // the reopen overlay is up — the canvas is read-only
```

In the editor's returned JSX, directly after `<Timeline />`, add:

```tsx
      <FolderOverlay />
      <ConflictBanner />
```

- [x] **Step 4: Append styles to `src/styles.css`**

```css
/* ---- Lecture folder ---- */
.folder-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; white-space: nowrap; }
.folder-chip.bad { border-color: #dc2626; color: #fca5a5; }
.folder-chip .chip-btn { padding: 0 6px; background: none; border: none; color: inherit; cursor: pointer; }
.conflict-banner { position: fixed; top: 56px; left: 50%; transform: translateX(-50%); z-index: 90; display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: #7f1d1d; color: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; }
```

- [x] **Step 5: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all succeed.

- [x] **Step 6: Smoke-test in Chrome**

`npm run dev`, open http://localhost:5173 in Chrome.
1. Classic mode still works: add a PNG, *Export .html*, open the downloaded file — image shows.
2. `mkdir -p /tmp/pres-sure-smoke` then *📁 Open folder…* → pick it. Chip reads `📁 pres-sure-smoke · saved`; `ls -R /tmp/pres-sure-smoke` shows `deck.pressure.json`, `index.html`, `assets/image.png`.
3. Add another image — a file with a readable name appears in `assets/` and the chip flickers `saving…` → `saved`.
4. Reload the page → the overlay appears; press Backspace with an element previously selected — nothing is deleted; click *Reopen* → editor restores.
Stop the server.

- [x] **Step 7: Commit**

```bash
git add src/components/FolderUI.tsx src/components/Toolbar.tsx src/App.tsx src/styles.css
git commit -m "feat: lecture-folder toolbar chip, reopen overlay and conflict banner"
```
(with the Co-Authored-By trailer)

---

### Task 8: Presenter view reads assets from the folder

**Files:**
- Modify: `src/components/PresenterView.tsx`

**Interfaces:**
- Consumes: `loadFolderHandle` (Task 6); `fsAccessFolder` (Task 2); `setRegistryFolder` (Task 4).
- Produces: nothing new.

- [x] **Step 1: Add imports**

```ts
import { loadFolderHandle, loadLocal } from "../store/persistence";
import { fsAccessFolder } from "../folder/folderIO";
import { setRegistryFolder } from "../folder/assetRegistry";
```

(replace the existing `import { loadLocal } from "../store/persistence";` with the first line).

- [x] **Step 2: Resolve folder access on mount**

Inside `PresenterView`, after the existing `const [elapsed, setElapsed] = useState(0);`, add:

```ts
  // In folder mode the deck holds asset paths; read them through the remembered folder.
  // Chrome grants folder permission per site, so this is normally already "granted".
  const [needsGrant, setNeedsGrant] = useState<FileSystemDirectoryHandle | null>(null);
  useEffect(() => {
    loadFolderHandle()
      .then(async (h) => {
        if (!h) return;
        if ((await h.queryPermission({ mode: "read" })) === "granted") setRegistryFolder(fsAccessFolder(h));
        else setNeedsGrant(h);
      })
      .catch(() => {});
  }, []);

  const grant = async () => {
    if (!needsGrant) return;
    if ((await needsGrant.requestPermission({ mode: "read" })) === "granted") {
      setRegistryFolder(fsAccessFolder(needsGrant));
      setNeedsGrant(null);
    }
  };
```

- [x] **Step 3: Show the grant button**

In the returned JSX, replace:

```tsx
      <div className="notes">
        <strong>Notes</strong>
```

with:

```tsx
      <div className="notes">
        {needsGrant && (
          <button className="primary" onClick={() => void grant()} style={{ marginBottom: 8 }}>
            Grant access to 📁 {needsGrant.name} to show images
          </button>
        )}
        <strong>Notes</strong>
```

- [x] **Step 4: Typecheck, test, verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

With the dev server and the `/tmp/pres-sure-smoke` folder from Task 7 open in the editor, click *Presenter*: the current and next panes show the folder's images (not grey placeholders).

- [x] **Step 5: Commit**

```bash
git add src/components/PresenterView.tsx
git commit -m "feat: presenter view loads lecture-folder assets"
```
(with the Co-Authored-By trailer)

---

### Task 9: Demo fixture, docs, and end-to-end verification

**Files:**
- Create: `scripts/make-folder-demo.mjs`
- Create (generated): `fixtures/folder-demo/deck.pressure.json`, `fixtures/folder-demo/assets/sun.svg`, `fixtures/folder-demo/assets/earth.svg`, `fixtures/folder-demo/assets/warming-stripes.png`
- Modify: `src/playback/deckFixtures.test.ts` (append a `describe`)
- Modify: `fixtures/README.md` (append a section)
- Modify: `docs/USER_MANUAL.md` (§9 and §12)

**Interfaces:**
- Consumes: `parseDeck` (Task 5), `isAssetPath` (Task 1).
- Produces: nothing for code.

- [x] **Step 1: Write the generator `scripts/make-folder-demo.mjs`**

```js
// Generates fixtures/folder-demo/: a lecture folder with real image files, for the manual
// checks in fixtures/README.md (docs/superpowers/plans/2026-10-14-asset-folders.md, Task 9).
// Plain ESM with no imports from src/, like make-test-deck.mjs; shapes mirror src/types.ts.
// index.html is deliberately absent — the editor writes it on first save.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = "fixtures/folder-demo";
const STAMP = Date.parse("2026-10-14T00:00:00Z");

// --- A tiny PNG encoder (8-bit RGB), so the demo has a genuine raster asset. ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function stripesPng(w, h, colors) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colors[Math.floor((x / w) * colors.length)];
      const o = y * row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Warming-stripes palette, cold to hot.
const STRIPES = [
  [8, 48, 107], [33, 102, 172], [67, 147, 195], [146, 197, 222],
  [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 13],
];

const SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="110" fill="#f59e0b"/></svg>\n`;
const EARTH = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" fill="#2563eb"/><path d="M50 70q30-30 60 0t30 40-50 20" fill="#16a34a"/></svg>\n`;

const lifecycle = { enterAt: null, enterEffect: "none", onExit: "persist" };
const image = (id, type, content, x, y, w, h, z) => ({
  id, type, x, y, w, h, rotation: 0, z, content, naturalW: w, naturalH: h, lifecycle,
});
const shot = (id, title, x, y, w, h, notes) => ({
  id, title, x, y, w, h, rotation: 0, duration: "auto", easing: "smooth", notes,
});

const deck = {
  id: "folder-demo",
  title: "Lecture folder demo",
  createdAt: STAMP,
  updatedAt: STAMP,
  world: { backgroundColor: "#ffffff" },
  elements: [
    {
      id: "t-title", type: "text", x: 0, y: 0, w: 860, h: 97, rotation: 0, z: 0,
      content: "Lecture folder demo",
      textStyle: { fontSize: 44, fontWeight: 600, color: "#18181b", align: "left" },
      lifecycle,
    },
    image("i-sun", "svg", "assets/sun.svg", 0, 200, 300, 300, 1),
    image("i-earth", "svg", "assets/earth.svg", 420, 260, 180, 180, 2),
    // Natural size is 64x16; drawn stretched so a missing file is obvious at a glance.
    { ...image("i-stripes", "image", "assets/warming-stripes.png", 0, 640, 800, 200, 3), naturalW: 64, naturalH: 16 },
  ],
  frames: [
    shot("f-title", "Title", -40, -40, 940, 529, "Title only. Images load from assets/, not from the deck."),
    shot("f-sun-earth", "Sun and Earth", -40, 160, 700, 394, "Two SVG files from assets/."),
    shot("f-stripes", "Warming stripes", -40, 600, 880, 495, "A PNG file from assets/."),
  ],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
};

mkdirSync(`${OUT}/assets`, { recursive: true });
writeFileSync(`${OUT}/assets/sun.svg`, SUN);
writeFileSync(`${OUT}/assets/earth.svg`, EARTH);
writeFileSync(`${OUT}/assets/warming-stripes.png`, stripesPng(64, 16, STRIPES));
writeFileSync(`${OUT}/deck.pressure.json`, JSON.stringify(deck, null, 2));
console.log(`wrote ${OUT}`);
```

- [x] **Step 2: Generate the fixture**

Run: `node scripts/make-folder-demo.mjs && ls -R fixtures/folder-demo && file fixtures/folder-demo/assets/warming-stripes.png`
Expected: the four files exist; `file` reports `PNG image data, 64 x 16, 8-bit/color RGB`.

- [x] **Step 3: Guard the fixture with a test**

Append to `src/playback/deckFixtures.test.ts` (add the two imports at the top with the others):

```ts
import { parseDeck } from "../folder/deckFolder";
import { isAssetPath } from "../folder/assetNames";
import folderDemoJson from "../../fixtures/folder-demo/deck.pressure.json";
```

```ts
describe("folder-demo deck", () => {
  const p = parseDeck(JSON.stringify(folderDemoJson));

  it("references every image by a relative assets/ path", () => {
    const images = p.elements.filter((e) => e.type !== "text");
    expect(images.length).toBe(3);
    for (const e of images) {
      expect(isAssetPath(e.content), e.id).toBe(true);
      expect(e.content.startsWith("assets/"), e.id).toBe(true);
    }
  });
});
```

Run: `npm test && npm run typecheck`
Expected: PASS.

- [x] **Step 4: Document the manual checks in `fixtures/README.md`**

Append:

````markdown
## `folder-demo/`

A lecture folder: `deck.pressure.json` plus real files in `assets/` (two SVGs and a PNG).
Regenerate with `node scripts/make-folder-demo.mjs`. Folder mode writes into the folder,
so **work on a copy** — never open the fixture itself:

```bash
rm -rf /tmp/folder-demo && cp -R fixtures/folder-demo /tmp/folder-demo
npm run dev   # then open http://localhost:5173 in Chrome or Edge
```

1. **📁 Open folder…** → `/tmp/folder-demo`. The demo deck loads with all three images.
   Move an element; within ~1 s `deck.pressure.json` changes and `index.html` appears
   (`ls -l /tmp/folder-demo`).
2. **Reload** → the *Reopen* overlay appears. Backspace does nothing. *Reopen* → the deck
   and images are back.
3. **Edit `deck.pressure.json` on disk** (e.g. change `"title"`), then click back into the
   tab → the conflict banner appears. Try both *Load from disk* (the new title shows) and,
   after repeating, *Keep mine* (the file is overwritten).
4. **Presenter** → current/next panes show the images.
5. **Serve the folder**: `npx serve /tmp/folder-demo`, open the URL → `index.html` plays
   all three frames with images; console is clean.
6. **Export .html** → move the downloaded file somewhere else and open it: it plays with
   all images (they are embedded again).
7. **Add an image** named `Keeling Curve.PNG` → `assets/keeling-curve.png` appears. Add the
   same file again → no new file.
8. **× on the folder chip** → images stay visible (re-embedded); the chip becomes
   *📁 Open folder…*.
9. **Firefox**: there is no *Open folder…* button and the editor works as before.
````

- [x] **Step 5: Update `docs/USER_MANUAL.md`**

In **§9 Saving, exporting & importing**, after the paragraph that starts "The exported file responds…" and before the `---` that ends §9, insert:

````markdown
### Lecture folders (Chrome & Edge)

For decks with many pictures — or a course site published from a git repo — keep each
lecture in its own folder instead of a single file:

```
lectures/01-energy-balance/
├── deck.pressure.json   ← the editable deck (small: images are referenced, not embedded)
├── assets/              ← every image you add, as an ordinary file
└── index.html           ← the player, regenerated automatically
```

- **📁 Open folder…** in the toolbar. An **empty** folder adopts the current project — its
  images are written to `assets/`. A folder that already has a `deck.pressure.json` opens
  that deck. A folder containing an `index.html` but no deck is refused, so an old
  presentation is never overwritten.
- From then on every edit is **saved to the folder about a second later**, together with a
  fresh `index.html`. The chip shows `📁 name · saved`. There is nothing to click: to publish,
  `git commit` and `git push`.
- Images keep a readable version of their file name (`Keeling Curve.PNG` →
  `assets/keeling-curve.png`). Adding the same picture twice stores it once. The editor never
  deletes files from `assets/` — tidy up by hand if you want to.
- Images added **by web link** stay links; they are never downloaded into the folder.
- After a reload, Chrome asks for permission again: click **Reopen 📁 name**.
- If `deck.pressure.json` changes on disk while the editor is open (say, after `git pull`),
  saving pauses and a banner offers **Load from disk** or **Keep mine**.
- **Save .json** and **Export .html** still download single, self-contained files with the
  images embedded — handy for email or offline use.
- **×** on the chip closes the folder; the images are embedded back into the deck.

Folder editing needs Chrome or Edge. The published `index.html` plays in every browser.
````

In **§12 Tips & limits**, in the *Not yet supported* bullet, append: `folder editing in Firefox/Safari (viewing works everywhere)`.

- [x] **Step 6: Run the full manual checklist**

Run: `npm run typecheck && npm test && npm run build`, then work through all nine steps of the new `fixtures/README.md` section in Chrome (and step 9 in Firefox). Record any failure as a bug against the owning task before continuing; do not mark this step done with a failing check.

- [x] **Step 7: Commit**

```bash
git add scripts/make-folder-demo.mjs fixtures/folder-demo src/playback/deckFixtures.test.ts fixtures/README.md docs/USER_MANUAL.md
git commit -m "docs: lecture-folder demo fixture, manual checks and user manual"
```
(with the Co-Authored-By trailer)
