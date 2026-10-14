# Lecture Folders & Assets by Reference — Design Doc

**Date:** 2026-10-14
**Status:** Approved, ready for implementation planning

## 1. Problem

Every image added to a deck is read with `FileReader.readAsDataURL` (`Toolbar.tsx`) and
stored as a base64 data URI in `Element.content`. That string then travels everywhere: the
zustand store, every undo snapshot, the IndexedDB autosave, *Save .json* and the exported
`.html`. For a picture-heavy course lecture this means tens of megabytes per deck, a full
new copy in git on every re-save, and no way to see or reuse the images as files.

The workflow is also single-project: autosave holds exactly one deck per browser, so moving
between lectures means *Save .json* → *Import* every time.

The target use is a course site (`intro_climate_science`) published on GitHub Pages, where
each lecture is a folder in the repo and publishing is `git commit && git push`.

## 2. What we are building

1. **Open folder** — in Chromium browsers, the editor opens a lecture folder (via the File
   System Access API) and treats it as the project's home.
2. **Assets by reference** — images added while a folder is open are written to
   `<folder>/assets/` and referenced from the deck by relative path.
3. **Continuous save + export** — every edit is written to `deck.pressure.json`, and
   `index.html` is regenerated beside it, so the folder is always ready to publish.

The on-disk layout of one lecture:

```
lectures/01-energy-balance/
├── deck.pressure.json   ← source; small, no base64
├── assets/
│   ├── keeling-curve.png
│   └── energy-budget.svg
└── index.html           ← exported player, loads assets/… by relative path
```

## 3. Decisions

### D1 — Folder access via File System Access API; Chromium only for editing.

Editing in folder mode requires `window.showDirectoryPicker` (Chrome, Edge). Where it is
absent the *Open folder…* button is hidden and the editor behaves exactly as today. The
published `index.html` plays in every browser — it is plain HTML with relative `<img src>`.
The alternative (download a zip on every save) was rejected as too much manual friction.

### D2 — Write timing: debounced autosave of the deck *and* the player.

About 1 s after editing stops, `deck.pressure.json` and `index.html` are both rewritten.
There is no Save or Export click in folder mode. The IndexedDB autosave keeps running as a
crash buffer. Chosen over "export on click" because the folder should always be
publishable; the author controls what students see by when they push.

### D3 — Assets are per lecture.

Each lecture folder has its own `assets/`. A figure reused across lectures is stored once
per lecture; git stores identical blobs once, so repository growth is negligible. A shared
course-level library (open the whole repo, switch lectures in-app) was considered and
deferred — it is a larger feature and makes lectures non-standalone.

### D4 — `Element.content` holds the relative path. *(Approach A)*

No type changes. `content` was always "whatever goes in `<img src>`"; in folder mode it is
`"assets/keeling-curve.png"`. The editor resolves paths to `blob:` object URLs at render
time through an asset registry. What is in memory equals what is on disk, undo snapshots
and the IndexedDB autosave shrink to kilobytes, and the exported runtime needs no change.

Rejected alternative (B): keep data URIs in memory and rewrite to paths only when saving —
less code touched today, but re-hashes every image on every save and leaves undo and
autosave as heavy as now.

### D5 — Three kinds of `content` coexist.

| Prefix | Meaning | Handling |
|---|---|---|
| `data:` | Legacy embedded asset | Rendered as-is; converted to a file by migration (D7) |
| `http:` / `https:` | Remote image (e.g. Wikimedia, added by link) | Rendered as-is; **never downloaded** |
| `blob:` | Should not be persisted, but tolerated | Rendered as-is |
| anything else | Path relative to the lecture folder | Resolved through the asset registry |

Remote-image support is being built separately; this design depends only on such images
having an `http(s):` URL in `content`.

### D6 — Asset naming: readable names, content-deduplicated.

A new asset is named from its original filename, sanitised: lower-case, runs of characters
outside `[a-z0-9._-]` become `-`, leading/trailing `-`/`.` trimmed, empty stem → `image`.
The extension is lower-cased; if missing, it is derived from the MIME type
(`png`, `jpg`, `webp`, `gif`, `svg`).

- If any existing file in `assets/` has identical bytes (SHA-256), that file is reused —
  regardless of its name.
- Otherwise, if the name is taken, append `-2`, `-3`, … before the extension.

### D7 — Migration of embedded decks is explicit and idempotent.

Opening an *empty* folder (no `deck.pressure.json`) adopts the current project: its data
URIs are written to `assets/` and replaced by paths. Importing a `.json` while a folder is
open does the same to the imported deck. Migrated assets are named `image.<ext>`, deduped
and suffixed per D6. Running migration on an already-migrated deck is a no-op.

### D8 — Disk is the source of truth; IndexedDB is a crash buffer.

When a folder is (re)opened its `deck.pressure.json` wins over the IndexedDB copy. Before
each write the editor compares the file's `lastModified` with the value it recorded at its
last read/write; a mismatch means something else (typically `git pull` / `git checkout`)
changed the deck, and the write is withheld (D10).

### D9 — Assets are never deleted by the editor.

Deleting an element leaves its file in `assets/`; undo can bring the element back and must
find the file. Cleaning unused assets is out of scope.

### D10 — Conflicts are surfaced, never auto-resolved.

On a `lastModified` mismatch — detected before a write, or when the tab regains focus /
visibility — saving pauses and a banner offers **Load from disk** (discard in-memory
changes) or **Keep mine** (overwrite the file and resume saving).

## 4. Components

### `src/folder/assetNames.ts` (new, pure)

- `sanitizeName(filename: string, mime: string): string` — D6 rules.
- `chooseAssetName(desired: string, hash: string, existing: Map<string, string>): { name: string; reused: boolean }`
  — `existing` maps file name → SHA-256 hex. Returns the reused name on a hash match,
  otherwise the first free `stem[-n].ext`.
- `sha256Hex(data: ArrayBuffer): Promise<string>` — via `crypto.subtle`.

### `src/folder/folderIO.ts` (new)

The I/O seam, so all logic above it is testable in Node.

```ts
export interface FolderIO {
  name: string;                                      // folder's display name
  readText(path: string): Promise<{ text: string; lastModified: number } | null>;
  readBlob(path: string): Promise<Blob | null>;
  write(path: string, data: Blob | string): Promise<{ lastModified: number }>;
  list(dir: string): Promise<string[]>;              // file names directly inside dir
  lastModified(path: string): Promise<number | null>;
}
```

- `fsAccessFolder(handle: FileSystemDirectoryHandle): FolderIO` — real implementation;
  creates `assets/` on first write into it. `write` returns the `lastModified` re-read from
  the written file.
- `memoryFolder(name, files?): FolderIO` — in-memory fake for tests; `lastModified` is a
  monotonically increasing counter, and the fake exposes a way to simulate an external edit.

### `src/folder/deckFolder.ts` (new)

Owns the open-folder session; no React.

- `openDeckFolder(io, current: Presentation, isDirty: boolean)` → one of
  `{ kind: "loaded", deck }` (folder had a deck), `{ kind: "adopted", deck, writes }` (empty
  folder; current project migrated per D7), with the "folder has other files but no deck"
  case treated as empty. Never overwrites an existing non-deck file. If a deck exists and
  `isDirty`, the caller confirms before replacing (the function reports, the UI asks).
  `isDirty` is defined as: the current project has any elements or frames **and** was not
  itself loaded from a folder in this session.
- `addAsset(io, file: File): Promise<string>` — hashes, names (D6), writes the file, warms
  the registry, returns the relative path. **Writes the file before returning**, so the
  caller only creates the element once its file exists.
- `saveDeck(io, p: Presentation)` — conflict check (D8), then writes
  `deck.pressure.json` (pretty-printed, as *Save .json* does today) and `index.html`
  (`buildHtml(p)`, paths untouched). Returns `"saved" | "conflict"`.
- `checkExternalChange(io)` — the focus-time variant of the conflict check.
- Keeps the session's `name → hash` map, built lazily from `assets/` on first `addAsset`.

### `src/folder/assetRegistry.ts` (new)

- `isAssetPath(content: string): boolean` — true when not `data:`, `http(s):` or `blob:`.
- `resolveAssetSrc(content: string): string` — pass-through for non-paths; for a path,
  the cached object URL, or a placeholder data URI (grey “loading”, or red
  “missing: assets/x.png” once a load has failed). A miss starts an async load through the
  current `FolderIO`.
- `useAssetSrc(content)` — React hook wrapping `resolveAssetSrc`, re-rendering when the
  load settles.
- `setRegistryFolder(io | null)` — switches folders; revokes all object URLs.

### `src/folder/migrate.ts` (new, pure apart from hashing)

`migrateEmbedded(p: Presentation, existing: Map<string,string>)` →
`{ deck: Presentation; files: { name: string; blob: Blob }[] }`. Converts `data:` contents
to paths per D6/D7; leaves `http(s):`, `blob:`, paths and text elements untouched.

### `src/export/inline.ts` (new)

`inlineAssets(p: Presentation, io: FolderIO): Promise<Presentation>` — the inverse of
migration: replaces paths with data URIs read from the folder. Used by *Save .json* and
*Export .html* in folder mode so those downloads stay portable and self-contained.

### `src/folder/folderStore.ts` (new)

A small separate zustand store — kept out of the main store so it is never captured by
zundo's undo history:

```ts
status: "none" | "needsPermission" | "open" | "conflict";
name: string | null;
saving: "idle" | "pending" | "saving" | "error";
```

### Persistence (`store/persistence.ts`)

Add `saveFolderHandle(handle | null)` / `loadFolderHandle()` using the existing
`presentations` object store under a new key `"folder"`. No DB version bump.

### Store wiring (`store/store.ts`)

Beside the existing IndexedDB autosave subscription, a second subscription: when
`folderStore.status === "open"` and the presentation changed, debounce ~1 s, then
`saveDeck`. A `"conflict"` result sets `status: "conflict"` and stops further writes until
resolved.

### Editor UI

- **Toolbar**: *Open folder…* (only if `showDirectoryPicker` exists) and a status chip —
  `📁 01-energy-balance · saved | saving… | conflict | error`.
- **Add image** in folder mode calls `addAsset` and then
  `addElement(type, "assets/<name>")`; otherwise today's data-URI path.
- **Import** in folder mode runs `migrateEmbedded` before `loadPresentation`.
- **Save .json / Export .html** in folder mode run `inlineAssets` first.
- **Reopen overlay**: on boot, if a folder handle is remembered, the IndexedDB deck is shown
  dimmed under a blocking overlay — *Reopen 📁 01-energy-balance* (calls
  `requestPermission`, then loads from disk per D8) or *Forget folder* (clears the handle;
  path-based images show as missing). The overlay is what makes the pre-permission state
  read-only — no per-action guards.
- **Conflict banner**: *Load from disk* / *Keep mine* (D10).
- **`ElementView.tsx`**: `ElementBody` uses `useAssetSrc(el.content)` for `src`. This is the
  single image render site, so editor, thumbnails, in-editor player and presenter all
  inherit it.

### Presenter view

`PresenterView` additionally loads the remembered handle from IndexedDB, checks
`queryPermission({ mode: "read" })`, and on `"granted"` sets the registry folder. Otherwise
it shows a *Grant access* button (permission requests need a user gesture).

### Export runtime

Unchanged. `img.src = el.content` (`runtime.ts`) resolves relative paths against
`index.html`'s location, on GitHub Pages and from `file://` alike.

## 5. Data flow

```
add image ─▶ addAsset: hash → name → write assets/x ─▶ registry warm ─▶ addElement("assets/x")
edit      ─▶ store.presentation changes
              ├─▶ (500 ms) IndexedDB autosave            [unchanged]
              └─▶ (~1 s, folder open) saveDeck
                     ├─ lastModified matches? ── no ─▶ status: conflict, banner
                     └─ yes ─▶ write deck.pressure.json + index.html
render    ─▶ ElementBody ─▶ useAssetSrc(content) ─▶ data:/http:/blob: as-is
                                                 └─ path ─▶ registry ─▶ blob: URL | placeholder
boot      ─▶ remembered handle? ── yes ─▶ overlay ─▶ Reopen ─▶ read deck from disk
                                  └─ no ─▶ today's behaviour
```

## 6. Error and edge cases

| Case | Behaviour |
|---|---|
| Browser lacks `showDirectoryPicker` | *Open folder…* hidden; editor unchanged |
| User cancels the picker | No change |
| Permission denied at Reopen | Overlay stays; *Forget folder* available |
| Folder has a deck and the current project is dirty (see `openDeckFolder`) | Confirm before replacing |
| Folder has files but no deck | Treated as empty; existing files never overwritten (names deduped per D6) |
| Asset file missing on disk | Red “missing” placeholder; saving continues |
| Write fails (disk full, permission revoked) | Status chip `error` with message; retried on next edit |
| Deck edited externally | Conflict banner (D10) |
| Element deleted | File kept (D9) |
| `https://` image | Never fetched or copied |
| Folder has an `index.html` but no deck (e.g. an old reveal.js lecture) | Refused with a message; nothing written |
| Opening a second folder while one is open | Current deck is inlined from the old folder first, so an empty new folder receives copies of its images |
| *Close folder* (× on the chip) | Images are re-embedded as data URIs, then the editor leaves folder mode |
| Malformed `deck.pressure.json` | Refused with a message; the file is neither loaded nor overwritten |

## 7. Testing

**Automated (Vitest, Node — no DOM needed):**

- `assetNames`: sanitisation (spaces, Unicode, upper-case extension, dot-only names, missing
  extension → MIME), content reuse across different names, `-2`/`-3` suffixing.
- `migrate`: a deck with three embedded images (two byte-identical) yields two files and
  three paths; `https:` and text untouched; second run is a no-op.
- `inline` ∘ `migrate` round-trips a deck through `memoryFolder`.
- `deckFolder` on `memoryFolder`: open with deck / empty / non-deck files; `addAsset` writes
  before returning; `saveDeck` writes both files; simulated external edit → `"conflict"`
  and no write.
- `resolveAssetSrc`: pass-through for `data:`, `https:`, `blob:`; registry hit; miss →
  placeholder.
- `buildHtml`: relative paths reach the output unchanged.

**Manual (Chrome)** — a new `fixtures/folder-demo/` (small deck + real image files) and a
checklist section in `fixtures/README.md`:

1. Open the folder, edit — both files update within ~1 s.
2. Reload → *Reopen* → everything restored.
3. Edit `deck.pressure.json` on disk, refocus the tab → conflict banner.
4. Presenter window shows images.
5. `npx serve` the folder → `index.html` plays with all images.
6. *Export .html* → one self-contained file that plays after the folder is moved.
7. Firefox → no *Open folder…*; editor works as before.

## 8. Out of scope

- Shared, course-level asset library and in-app lecture switching (D3).
- Deleting unused assets (D9).
- Folder editing in Firefox / Safari.
- Live file watching beyond the focus-time check.
- Remote-image-by-link UI (built separately; see D5).
- Deploying the editor to GitHub Pages and building the `intro_climate_science` site —
  separate pieces of work that follow this one.
