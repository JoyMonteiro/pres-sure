# Images from the Web (Wikimedia first) — Design Doc

**Date:** 2026-10-14
**Status:** Draft, awaiting review

## 1. Problem

The only way to get an image into a deck is *+ Image / GIF / SVG*, which reads a local file
(`Toolbar.tsx`). Lecture decks draw heavily on Wikimedia Commons, so every figure means
download → find the file → upload → hand-type the credit. Two things make this worse than
it looks:

- The image that is easy to grab is the wrong one. Commons' *Use this file on the web*
  snippet, and any image dragged off a Wikipedia article, point at a **250px thumbnail**.
  Shown full-screen it is magnified ~6×, well past the 1.3× blur hint in `ElementView.tsx`.
- Most Commons images are CC BY-SA and **require visible attribution**, which is easy to
  forget when it has to be typed by hand.

This is sub-project 1 of two. Sub-project 2 (a live web embed, e.g. a Mentimeter results
view) is separate and gets its own spec.

## 2. What we are building

1. **+ From web** — paste a Commons embed snippet, a Wikipedia/Commons file URL, a
   Wikimedia image URL, or any other image URL. The editor finds the best-resolution
   version, previews it, and adds it to the canvas.
2. **Link or copy, per image** — an image is either *linked* (its `https://` URL is the
   element's content and is loaded when shown) or *copied* (downloaded and stored like an
   uploaded image). The project remembers the last choice as its default.
3. **Automatic credit** — Wikimedia images arrive with a caption text element underneath
   carrying the credit line, e.g. *"Godfrey Kneller, Public domain, via Wikimedia
   Commons"*.
4. **Paste to add** — pasting an image link onto the canvas opens the same dialog,
   pre-filled.

## 3. Decisions

### D1 — Storage is the asset layer's business; this feature only produces a source.

`docs/superpowers/specs/2026-10-14-asset-folders-design.md` (branch `asset-folders`, being
built in parallel) owns how images are stored. Its D5 already defines a linked image: an
`http(s):` URL in `Element.content`, rendered as-is and never downloaded. This feature
therefore:

- writes the URL into `content` for a **linked** image — nothing else is needed;
- passes the downloaded bytes to one seam, `storeImageBlob(blob, nameHint)`, for a
  **copied** image. On `main` today the seam returns a data URI (exactly what an upload
  produces). When asset-folders lands, the seam calls its `addAsset` in folder mode. That
  is the only integration point.

### D2 — Link or copy is chosen per image; the project holds the default.

`PresentationSettings` gains `webImages?: "link" | "copy"`. Absent means `"link"` — decks
with many images stay light, and old saves need no migration. The dialog's *Save a copy in
the project* checkbox starts from this value, and the value the user adds with becomes the
new default. There is no separate settings control. A linked image can later be converted
with *Save a copy* in the properties panel; there is no reverse conversion (a copy has no
URL to go back to).

### D3 — Wikimedia inputs are resolved through the API of the wiki they came from.

A file is identified by `{ wiki, title }`, where `wiki` is an API host
(`commons.wikimedia.org`, `en.wikipedia.org`, …) and `title` is `File:…`. One request
resolves it:

```
https://<wiki>/w/api.php?action=query&format=json&formatversion=2&origin=*
  &prop=imageinfo&iiprop=url|size|mime|extmetadata
  &iiextmetadatafilter=Artist|LicenseShortName|AttributionRequired
  &iiurlwidth=3840&titles=<title>
```

Verified on 2026-10-14 against live responses:

- Every Wikimedia endpoint involved — both wiki APIs (with `origin=*`), `upload.` and
  `thumb.wikimedia.org` — sends `access-control-allow-origin: *`, so the browser can both
  display and download the files directly, with no proxy.
- Asking the wiki the link came from (rather than always Commons) also covers files hosted
  locally on a Wikipedia; those wikis' APIs answer for Commons files too.
- Rewriting the width in a thumbnail URL is **not** a substitute: `1280px-` works for the
  Newton portrait but `2560px-` returns HTTP 400, because thumbnails cannot exceed the
  original (2218px). The API returns the original in that case.
- Thumbnails come only in fixed widths. A request is rounded **up** to the next of 1280,
  1920 or 3840 (asking for 2000 or 2560 yields `3840px-`), and when the original is not much
  larger than the request, the original itself comes back (`utm_content=thumbnail_unscaled`;
  e.g. a 3000×3002 JPEG for a 2560 request). Size for a 6780px original: 1920px ≈ 570 KB,
  3840px ≈ 3 MB. 3840 is requested so images stay sharp when zoomed on a large display.
- `thumbwidth`/`thumbheight` echo the *request*, not the file served (`File:Example.jpg` is
  172×178 but reports `thumbwidth: 2560`; the 6780px original reports 2560 while serving
  3840). They are never used.
- A missing file comes back as `pages[0].missing: true` with no `imageinfo`.
- `title` may be sent with underscores or spaces; the API normalises it.

### D4 — Which URL is used.

| `mime` | URL used | Why |
|---|---|---|
| `image/svg+xml` | `url` (the original SVG) | Vector stays sharp at any zoom; `thumburl` is a PNG |
| `image/gif` | `url` (the original) | Large GIF thumbnails may lose animation |
| anything else | `thumburl` | ≤3840px wide (often the original — see D3) |

`utm_source`, `utm_campaign` and `utm_content` query parameters are stripped from the
chosen URL. The element's `w`×`h` use the original's aspect ratio; `naturalW`/`naturalH`
are the pixel size of the chosen file: if its path contains `/<n>px-`, `naturalW = n` and
`naturalH = round(n × originalH / originalW)`; otherwise it is the original, and both come
from `width`/`height`. SVG gets no `naturalW`/`naturalH`, which matches uploaded SVGs today.

### D5 — The credit line.

- From a pasted **snippet**: the `<a title="…">` text, verbatim after entity decoding.
  Commons writes it in the form *Artist, Licence, via Wikimedia Commons*.
- From a **URL**: built in the same form from `extmetadata`. `Artist.value` is HTML — tags
  are stripped, entities decoded, whitespace collapsed. `LicenseShortName.value` is used
  as-is. Missing parts are dropped: *Artist, via Wikimedia Commons*, *Licence, via
  Wikimedia Commons*, or just *via Wikimedia Commons*.
- **Other** web images have no credit and get no caption.

### D6 — The caption is an ordinary text element. *(User choice: option 1)*

The image and caption are added in **one** store action (`addElements`), so a single undo
removes both. Geometry, for an image at `x, y, w, h`:

- `fontSize = max(10, round(w × 0.035))`, `fontWeight 400`, `color #6b6b73`, `align left`
- caption box: `x`, `y + h + round(fontSize × 0.5)`, width `w`, height `round(fontSize × 3)`
  (room for two lines)
- content: the credit text with `&`, `<`, `>` escaped (the text box's content is HTML)

The caption is not linked to the image: moving, resizing or deleting one leaves the other
alone. The user can restyle or delete it.

### D7 — Placement.

At the centre of the editor view (as `addElement` already does), width **400** world units
(the existing default for uploads), height `round(400 × originalH / originalW)`. When the
aspect ratio is unknown — an *other* web image whose probe failed — 400×300, the same as an
upload today.

### D8 — Input recognition.

`parseImageInput(text)` trims the input and returns the first match, in this order:

1. **HTML containing `<a … href="…">` whose href is a file page** (rule 2 below) → a
   Wikimedia input, plus the `<a title>` as `credit` and the inner `<img src>` as `fallbackSrc`.
2. **File page URL** — host `*.wikipedia.org`, `*.m.wikipedia.org`, `commons.wikimedia.org`,
   `commons.m.wikimedia.org`; title taken from `/wiki/File:<t>`, `#/media/File:<t>`, or
   `?title=File:<t>`. The `.m.` is removed to get the API host. The title is percent-decoded.
3. **Wikimedia image URL** — host `upload.wikimedia.org` or `thumb.wikimedia.org`, path
   `/wikipedia/<project>/[thumb/]<h>/<hh>/<file>[/<n>px-<file>]`. `<project>` `commons` →
   `commons.wikimedia.org`; a language code such as `en` → `en.wikipedia.org`. Title
   `File:` + percent-decoded `<file>`.
4. **HTML containing `<img src="…">`** (e.g. a browser's *Copy image* clipboard) → parse
   the `src` again with rules 2–5.
5. **Any other `http:`/`https:` URL** → an *other* web image.
6. Otherwise → error *"Paste a Wikimedia link, its embed snippet, or an image URL."*

Parsing is done with regular expressions and a small entity decoder — not `DOMParser` — so
it is testable in Vitest's Node environment. Attribute values may use `"` or `'`.

### D9 — Other web images.

Their size comes from loading the URL into an `Image()` in the page (no CORS needed to
display). The element type comes from the URL path's extension: `.svg` → `svg`, `.gif` →
`gif`, otherwise `image`. Copying them may fail because many sites block cross-origin
downloads. That is reported in the dialog as *"This site doesn't allow copying — add it as
a link instead."* The *Save a copy* checkbox is cleared so one click on *Add* links it.

## 4. Components

### `src/remote/parseImageInput.ts` (new, pure)

```ts
export type ImageInput =
  | { kind: "wikimedia"; wiki: string; title: string; credit?: string; fallbackSrc?: string }
  | { kind: "web"; url: string }
  | { kind: "invalid"; message: string };

export function parseImageInput(text: string): ImageInput;
export function decodeEntities(s: string): string;   // &amp; &lt; &gt; &quot; &#39; &#NN; &#xNN;
export function htmlToText(html: string): string;    // strip tags → decode → collapse spaces
```

### `src/remote/resolveImage.ts` (new; network injected)

```ts
export type FetchJson = (url: string) => Promise<unknown>;

export interface ResolvedImage {
  url: string;               // what goes in <img src> / is downloaded
  type: ElementType;         // "image" | "gif" | "svg"
  aspect: number | null;     // originalH / originalW; null if unknown
  naturalW?: number;
  naturalH?: number;
  credit?: string;           // undefined → no caption
  lowRes?: boolean;          // true when the API failed and fallbackSrc was used
}

export function apiUrl(wiki: string, title: string): string;
export function stripTracking(url: string): string;
export function resolveWikimedia(
  input: Extract<ImageInput, { kind: "wikimedia" }>,
  fetchJson: FetchJson
): Promise<ResolvedImage>;   // throws Error with a user-facing message
export function probeWebImage(url: string): Promise<ResolvedImage>;  // DOM Image(); not unit-tested
export function typeFromPath(url: string): ElementType;
```

`resolveWikimedia` error handling:

| Case | Result |
|---|---|
| `missing: true` | throw *"Wikimedia has no file called <title>."* |
| network / non-JSON failure, `fallbackSrc` present | resolve with `fallbackSrc`, `lowRes: true`, `credit` from the snippet, `aspect: null` |
| network / non-JSON failure, no fallback | throw *"Couldn't reach Wikimedia — check your connection."* |

### `src/remote/layoutWebImage.ts` (new, pure)

```ts
export function layoutWebImage(
  r: ResolvedImage,
  center: { cx: number; cy: number }
): { image: Partial<Element>; caption?: Partial<Element> };
```

Implements D6 and D7 exactly. It returns partials the store turns into elements (no ids,
no z) — `image` without `content`, which the caller supplies after deciding link or copy.

### `src/store/assets.ts` (new — the D1 seam)

```ts
export const blobToDataUrl: (b: Blob) => Promise<string>;   // moved from Toolbar's fileToDataUrl
export async function storeImageBlob(blob: Blob, _nameHint: string): Promise<string>;
```

Today `storeImageBlob` returns `blobToDataUrl(blob)`. `Toolbar.tsx`'s upload path is
switched to `blobToDataUrl` so there is one copy of the FileReader code.

### `src/remote/copyRemote.ts` (new)

`copyRemoteImage(url: string): Promise<string>` — `fetch(url)`, `!ok` or a thrown
`TypeError` (CORS / offline) → throw *"This site doesn't allow copying — add it as a link
instead."*. Otherwise `storeImageBlob(blob, nameHintFromUrl(url))`, where the hint is the
URL path's last segment, percent-decoded.

### Store (`store/store.ts`, `types.ts`)

- `types.ts`: `PresentationSettings.webImages?: "link" | "copy"`.
- `addElements(items: { type: ElementType; content: string; extra?: Partial<Element> }[]): string[]`
  — one `set`, each item built like `addElement` (`makeElement`, `nextZ` incrementing per
  item, explicit `x`/`y` from `extra`); selects the **first** id; one undo step.
- `setWebImagesDefault(v: "link" | "copy")` — writes `settings.webImages`; history-tracked
  like other presentation mutations. The dialog calls it only when the chosen value differs
  from the current default, and *before* `addElements`, so the first undo after *Add*
  removes the image and caption.

### UI

- **`src/components/WebImageDialog.tsx`** (new): a `.modal` with a textarea (snippet or
  URL), resolution status (*Looking up…*, error text, or a preview `<img>` plus credit and
  *"Low resolution — Wikimedia couldn't be reached"* when `lowRes`), the *Save a copy in the
  project* checkbox, and *Cancel* / *Add*. Input is resolved 400 ms after typing stops;
  a newer input discards an older in-flight result. *Add* is disabled until resolved;
  while copying it reads *Downloading…*. On success: `setWebImagesDefault`, then
  `addElements([image, caption?])`, then close. *Escape* closes.
- **Toolbar**: *+ From web* next to *+ Image / GIF / SVG*, opening the dialog empty.
- **Paste** (`App.tsx` `Editor`): a `paste` listener on `window` in edit mode. It does
  nothing while typing (same `typing` test as the key handler), while the template picker
  (`showPicker`) is showing, or while the web-image dialog is already open.
  It reads `text/html`, else `text/plain`; if `parseImageInput` is not `invalid`, it
  `preventDefault()`s and opens the dialog pre-filled. The dialog's open state lives in
  `Editor` and is passed to `Toolbar` as a callback.
- **Properties panel** (`ElementProps`): for an `image`/`gif`/`svg` element whose content
  starts with `http:`/`https:`, a line *"Linked from <host> — needs internet to show"* and
  a *Save a copy* button → `copyRemoteImage` → `updateElement(id, { content })`. Errors are
  shown inline under the button.

### Unchanged

`ElementBody` (already renders any `src`), thumbnails, `Stage`, presenter view, the export
runtime (`img.src = el.content` works for URLs), `buildHtml`.

## 5. Data flow

```
paste / type ─▶ parseImageInput ─┬─ wikimedia ─▶ resolveWikimedia(fetchJson) ─┐
                                 ├─ web ───────▶ probeWebImage ───────────────┤
                                 └─ invalid ───▶ inline message               │
                                                                              ▼
                                                   ResolvedImage ─▶ preview + credit
Add ─▶ copy? ── no ──▶ content = url ─────────────────────────────┐
           └─ yes ─▶ copyRemoteImage ─▶ storeImageBlob ─▶ content ─┤
                                                                   ▼
             layoutWebImage ─▶ addElements([image, caption?])  (one undo step)
```

## 6. Error and edge cases

| Case | Behaviour |
|---|---|
| Not a link or snippet | Inline message (D8.6); *Add* disabled |
| Wikimedia file missing | Inline message; *Add* disabled |
| Wikimedia unreachable, snippet pasted | 250px fallback added with a low-resolution warning |
| Wikimedia unreachable, URL pasted | Inline message; *Add* disabled |
| Other web image fails to load in probe | *"Couldn't load an image from that address."*; *Add* disabled |
| Copy blocked by the site (CORS) or offline | Inline message, checkbox cleared, *Add* links instead |
| Linked image offline at show time | Browser's broken-image rendering (same as any `<img>`); out of scope to improve |
| Exported `.html` with linked images | Images load from the web — the file needs internet for those images. Documented in the user manual. |
| Paste while editing a text box or typing in a field | Ignored by the listener — normal paste |

## 7. Testing

**Automated (Vitest, Node):**

- `parseImageInput`: the exact Newton snippet from §8; file-page URLs on Commons, `en.`,
  `en.m.`, `#/media/` and `?title=` forms; percent-encoded titles (`%2C`, `%28`); both
  `upload.` and `thumb.` image URLs, with and without the `/250px-` suffix, for `commons`
  and `en`; a bare `<img src>` fragment; a non-Wikimedia URL; empty and nonsense input;
  single-quoted attributes.
- `decodeEntities` / `htmlToText`: named, decimal and hex entities; the real `Artist` HTML
  from `File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg` →
  *"Godfrey Kneller"*.
- `resolveWikimedia` with a fake `FetchJson` serving trimmed copies of real responses
  (stored as test fixtures): Newton JPEG (2218×2671, original returned → natural size 2218×2671,
  credit from snippet when given and built from metadata when not); `Wikipedia-logo-v2.svg`
  (original SVG URL, no natural size); `Rotating earth (large).gif` (original); a file
  `The_Earth_seen_from_Apollo_17.jpg` (3000×3002, unscaled original returned for the
  request); `Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg` (6780×7071 →
  `3840px-` thumb, natural 3840×4004); missing file; fetch rejection with and
  without `fallbackSrc`. Every returned URL has no `utm_` parameters; `apiUrl` output
  matches D3.
- `layoutWebImage`: aspect → height; caption geometry and font size; escaping of `&` and
  `<` in the credit; no caption without credit; 400×300 when `aspect` is null.

**Manual (Chrome, `npm run dev`):** add a checklist section to `fixtures/README.md`:

1. Paste the Newton snippet into *+ From web* → preview, credit, *Add* → portrait with the
   correct proportions and caption; one undo removes both.
2. Zoom into the portrait — no blur hint (natural width 2218).
3. Paste `https://en.wikipedia.org/wiki/Isaac_Newton` with an image open
   (`#/media/File:…`) → resolves; credit built from metadata.
4. Paste `https://commons.wikimedia.org/wiki/File:Wikipedia-logo-v2.svg` → stays sharp at
   deep zoom.
5. With *Save a copy* checked → `content` is a `data:` URI (check *Save .json*); reopen
   the dialog → checkbox still checked.
6. Linked image → properties panel shows *Linked from upload.wikimedia.org*; *Save a copy*
   converts it.
7. Paste a snippet straight onto the canvas (Cmd+V, nothing selected) → dialog opens
   pre-filled. Paste inside a text box → normal paste.
8. *Export .html* with one linked and one copied image → both show online; with the network
   off only the copied one shows.
9. A non-Wikimedia image URL from a site without CORS → link works, copy reports the
   message.

## 8. Reference input

The snippet Commons provides (used verbatim in tests):

```html
<a title="Godfrey Kneller, Public domain, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"><img width="250" alt="Sir Isaac Newton" src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail"></a>
```

## 9. Integration with asset-folders

Whichever branch merges second does this:

- `storeImageBlob` in folder mode calls `addAsset(io, new File([blob], nameHint, { type: blob.type }))`
  and returns its relative path; outside folder mode it keeps returning a data URI.
- Nothing else. Linked images are D5's `http(s):` case in that spec; its `inlineAssets`
  leaves them untouched, its registry passes them through.

## 10. Out of scope

- Live web embeds (sub-project 2).
- Dragging an image in from another browser tab (the parser already accepts the URLs this
  produces, so this is a small follow-up).
- Caption linked to its image (moving together, auto-deleted).
- Copying linked images into a self-contained export automatically.
- Image search inside the editor.
- A placeholder for linked images that fail to load.
