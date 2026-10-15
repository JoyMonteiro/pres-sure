# Images from the Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the author add images to a deck from the web: paste a Wikimedia Commons embed snippet, a Wikipedia/Commons file link, a Wikimedia image URL or any image URL; get the 1920px version with the right shape, a credit caption, and a per-image choice between linking and storing a copy.

**Architecture:** Pure, Node-testable modules in `src/remote/` turn pasted text into an `ImageInput` (`parseImageInput`), resolve it through the Wikimedia API or an image probe into a `ResolvedImage` (`resolveInput`, network injected), and lay it out with its caption (`layoutWebImage`). A React dialog wires these to two new store actions (`addElements` — one undo step — and `setWebImagesDefault`). Storing a copy goes through a single seam, `storeImageBlob` (`src/store/assets.ts`), which returns a data URI today and is where the parallel asset-folders work will plug in.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), Zustand + immer + zundo, Vitest 4 (Node environment — no DOM in tests), Vite 6.

**Spec:** `docs/superpowers/specs/2026-10-14-web-images-design.md` — read it before starting. Every behaviour below argues from it.

## Before you start

- Work in the existing worktree **`/Users/joymonteiro/github/pres-sure-web-images`**, branch **`web-images`** (already created from `main`, spec committed). Do **not** work in `/Users/joymonteiro/github/pres-sure` — another session is using that checkout on branch `asset-folders`.
- Run `npm ci` once in the worktree if `node_modules/` is missing.
- Baseline: `npx vitest run` → 4 files, 41 tests pass; `npx tsc -b --noEmit` → no output.
- All code in this plan was run before the plan was written: the final state is 9 test files / 114 tests passing, a clean typecheck, a clean `npx vite build`, and the dialog was exercised end to end in Chrome against the live Wikimedia API. If a test you copy from here fails, the transcription is the first suspect.

## Global Constraints

- Wikimedia API request width: `iiurlwidth=1920` (user decision; `REQUEST_WIDTH = 1920`).
- Credit format: `Artist, Licence, via Wikimedia Commons` — or `via Wikipedia` for a file hosted on that Wikipedia (`imagerepository` not `"shared"` and wiki not Commons).
- `PresentationSettings.webImages?: "link" | "copy"`; absent means `"link"`. Never write it unless the user's choice differs from the current default.
- Linked image ⇒ `Element.content` is the `https://` URL. Copied image ⇒ `content` is whatever `storeImageBlob` returns (a `data:` URI today).
- Web image default width **400** world units, height from the original's aspect ratio; unknown aspect ⇒ 400×300.
- Caption: `fontSize = max(10, round(w × 0.035))`, weight 400, colour `#6b6b73`, left-aligned; box at `(x, y + h + round(fontSize × 0.5))`, size `w × round(fontSize × 3)`; content HTML-escaped (`&`, `<`, `>`).
- Image + caption are added in ONE store action ⇒ one undo removes both.
- User-facing messages, verbatim:
  - `Paste a Wikimedia link, its embed snippet, or an image URL.`
  - `Wikimedia has no file called <title>.`
  - `Couldn't reach Wikimedia — check your connection.`
  - `Couldn't load an image from that address.`
  - `This site doesn't allow copying — add it as a link instead.`
  - `That address didn't return an image.`
- Tests run in Node: no `DOMParser`, no `FileReader`, no `Image`, no IndexedDB. Browser-only code lives in `src/remote/browser.ts`, `src/store/assets.ts` and components.
- Do not touch `src/export/runtime.ts`, `src/export/exportHtml.ts`, `ElementView.tsx`, `Stage.tsx` or thumbnails — they already render any `src`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

These are the failure modes most likely to bite a real user that no automated test exercises (the UI has no DOM test environment). Each has a manual check in the owning task.

1. **Pasting inside a text box or input** must paste normally, never open the dialog (Task 5, Step 6 check b).
2. **Fast or repeated edits in the dialog's textarea** while a lookup is in flight must show only the result for the *current* text, never a stale one (Task 5, Step 6 check c).
3. **Copy refused by a non-Wikimedia site**: the message appears, the checkbox clears, and clicking *Add* again links the image (Task 5, Step 6 check e).
4. **Undo right after *Add*** removes image *and* caption together, even when *Add* also changed the link/copy default (Task 5, Step 6 check d).
5. **Linked images in an exported `.html` with the network off** show as broken images and copied ones still show — this is accepted behaviour and must be documented (Task 7).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/remote/parseImageInput.ts` | create | Recognise pasted text → `ImageInput`; `decodeEntities`, `htmlToText` |
| `src/remote/resolveImage.ts` | create | `ImageInput` → `ResolvedImage` via injected `fetchJson`/`probeSize`; credit; URL choice |
| `src/remote/wikimediaFixtures.ts` | create | Trimmed real API responses for tests |
| `src/remote/layoutWebImage.ts` | create | Image + caption geometry |
| `src/remote/copyRemote.ts` | create | Download a web image and store it; `isRemoteUrl`, `hostOf`, `nameHintFromUrl` |
| `src/remote/browser.ts` | create | Browser `fetchJson` and `probeSize` |
| `src/store/assets.ts` | create | `blobToDataUrl`, `storeImageBlob` — the asset-folders seam |
| `src/components/WebImageDialog.tsx` | create | The *+ From web* dialog |
| `src/types.ts` | modify | `WebImagesMode`, `PresentationSettings.webImages?` |
| `src/store/store.ts` | modify | `NewElement`, `addElements`, `setWebImagesDefault` |
| `src/components/Toolbar.tsx` | modify | *+ From web* button; upload uses `blobToDataUrl` |
| `src/App.tsx` | modify | Dialog state, paste-to-open listener |
| `src/components/PropertiesPanel.tsx` | modify | *Linked from …* + *Save a copy* for linked images |
| `src/styles.css` | modify | Dialog styles, `.error` |
| `docs/USER_MANUAL.md`, `fixtures/README.md` | modify | User docs, manual checklist |

Tests: `src/remote/parseImageInput.test.ts`, `src/remote/resolveImage.test.ts`, `src/remote/layoutWebImage.test.ts`, `src/remote/copyRemote.test.ts`, `src/store/webImages.test.ts`.

---

### Task 1: Recognise pasted input

**Files:**
- Create: `src/remote/parseImageInput.ts`
- Test: `src/remote/parseImageInput.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ImageInput =
    | { kind: "wikimedia"; wiki: string; title: string; credit?: string; fallbackSrc?: string }
    | { kind: "web"; url: string }
    | { kind: "invalid"; message: string };
  export const INVALID_INPUT_MESSAGE: string;
  export function parseImageInput(text: string): ImageInput;
  export function decodeEntities(s: string): string;
  export function htmlToText(html: string): string;
  ```
  `wiki` is an API host (`commons.wikimedia.org`, `en.wikipedia.org`); `title` is `File:` + the name with underscores turned into spaces (the API's normalised form).

- [ ] **Step 1: Write the failing test**

Create `src/remote/parseImageInput.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INVALID_INPUT_MESSAGE, decodeEntities, htmlToText, parseImageInput } from "./parseImageInput";

// The snippet Commons offers under "Use this file on the web" (spec §8), verbatim.
const NEWTON_SNIPPET =
  '<a title="Godfrey Kneller, Public domain, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"><img width="250" alt="Sir Isaac Newton" src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail"></a>';

const NEWTON = "File:Portrait of Sir Isaac Newton, 1689 (brightened).jpg";
const COMMONS = "commons.wikimedia.org";
const invalid = { kind: "invalid", message: INVALID_INPUT_MESSAGE };

describe("parseImageInput — Commons snippet", () => {
  it("takes the file from href, the credit from title and the thumbnail as fallback", () => {
    expect(parseImageInput(NEWTON_SNIPPET)).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: NEWTON,
      credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
      fallbackSrc:
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail",
    });
  });

  it("tolerates surrounding whitespace and single-quoted attributes", () => {
    const html = `  \n<a title='A &amp; B, CC BY 4.0, via Wikimedia Commons' href='https://commons.wikimedia.org/wiki/File:X.png'><img src='//upload.wikimedia.org/wikipedia/commons/a/ab/X.png'></a>\n`;
    expect(parseImageInput(html)).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: "File:X.png",
      credit: "A & B, CC BY 4.0, via Wikimedia Commons",
      fallbackSrc: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.png",
    });
  });

  it("treats a bare <img> fragment as its src", () => {
    const html = '<meta charset="utf-8"><img src="https://example.org/pics/cat.png" alt="cat">';
    expect(parseImageInput(html)).toEqual({ kind: "web", url: "https://example.org/pics/cat.png" });
  });

  it("resolves a bare <img> pointing at Wikimedia to the file", () => {
    const html =
      '<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg">';
    expect(parseImageInput(html)).toEqual({ kind: "wikimedia", wiki: COMMONS, title: NEWTON });
  });

  it("rejects HTML with neither a file link nor an image", () => {
    expect(parseImageInput("<p>hello</p>")).toEqual(invalid);
  });
});

describe("parseImageInput — file pages", () => {
  it.each([
    ["https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
    ["https://commons.m.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
    ["https://en.wikipedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://en.m.wikipedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://en.wikipedia.org/wiki/Isaac_Newton#/media/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg", COMMONS],
    ["https://commons.wikimedia.org/w/index.php?title=File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
  ])("%s", (url, wiki) => {
    expect(parseImageInput(url)).toEqual({ kind: "wikimedia", wiki, title: NEWTON });
  });

  it("accepts the legacy Image: prefix", () => {
    expect(parseImageInput("https://en.wikipedia.org/wiki/Image:Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: "en.wikipedia.org",
      title: "File:Example.jpg",
    });
  });

  it("treats an article URL without a media fragment as an ordinary web URL", () => {
    expect(parseImageInput("https://en.wikipedia.org/wiki/Isaac_Newton")).toEqual({
      kind: "web",
      url: "https://en.wikipedia.org/wiki/Isaac_Newton",
    });
  });
});

describe("parseImageInput — Wikimedia image URLs", () => {
  it.each([
    "https://upload.wikimedia.org/wikipedia/commons/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1280px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=x",
  ])("%s", (url) => {
    expect(parseImageInput(url)).toEqual({ kind: "wikimedia", wiki: COMMONS, title: NEWTON });
  });

  it("maps a language project to its Wikipedia", () => {
    expect(parseImageInput("https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: "en.wikipedia.org",
      title: "File:Example.jpg",
    });
  });

  it("accepts protocol-relative URLs", () => {
    expect(parseImageInput("//upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: "File:Example.jpg",
    });
  });

  it("treats other paths on the image hosts as ordinary web URLs", () => {
    expect(parseImageInput("https://upload.wikimedia.org/favicon.ico").kind).toBe("web");
  });
});

describe("parseImageInput — other input", () => {
  it("keeps any other http(s) URL as a web image", () => {
    expect(parseImageInput("https://example.org/a/b.svg?x=1")).toEqual({
      kind: "web",
      url: "https://example.org/a/b.svg?x=1",
    });
  });

  it.each(["", "   ", "hello world", "example.org/cat.png", "ftp://example.org/cat.png", "javascript:alert(1)"])(
    "rejects %j",
    (text) => {
      expect(parseImageInput(text)).toEqual(invalid);
    }
  );
});

describe("decodeEntities / htmlToText", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2013; &bogus;")).toBe(
      "a & b <c> \"d\" 'e' – &bogus;"
    );
  });

  it("leaves out-of-range code points alone", () => {
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
  });

  it("reduces Commons' Artist HTML to the name", () => {
    const artist =
      '<bdi><a href="https://en.wikipedia.org/wiki/en:Godfrey_Kneller" class="extiw" title="w:en:Godfrey Kneller"><span title="German-born British painter (1646–1723)">Godfrey Kneller</span></a></bdi>';
    expect(htmlToText(artist)).toBe("Godfrey Kneller");
  });

  it("keeps punctuation tight around links and separates block elements", () => {
    const artist =
      '<p>Original by <a href="//en.wikipedia.org/wiki/User:Gutza" title="User:Gutza">Gutza</a>, modifications by <a href="//en.wikipedia.org/wiki/User:Centrx">Centrx</a>\n</p>';
    expect(htmlToText(artist)).toBe("Original by Gutza, modifications by Centrx");
    expect(htmlToText("<p>one</p><p>two</p>a<br>b")).toBe("one two a b");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/remote/parseImageInput.test.ts`
Expected: FAIL — `Failed to resolve import "./parseImageInput"`.

- [ ] **Step 3: Implement**

Create `src/remote/parseImageInput.ts`:

```ts
// Recognise what was pasted into "+ From web" (spec D8): a Commons embed snippet, a
// Wikipedia/Commons file page, a Wikimedia image URL, or any other image URL.
// Regex-based rather than DOMParser so it runs under Vitest's Node environment.

export type ImageInput =
  | { kind: "wikimedia"; wiki: string; title: string; credit?: string; fallbackSrc?: string }
  | { kind: "web"; url: string }
  | { kind: "invalid"; message: string };

export const INVALID_INPUT_MESSAGE = "Paste a Wikimedia link, its embed snippet, or an image URL.";

const INVALID: ImageInput = { kind: "invalid", message: INVALID_INPUT_MESSAGE };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Wikimedia metadata is HTML; reduce it to the words a caption needs. */
export function htmlToText(html: string): string {
  const spaced = html.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|div|li)>/gi, " ");
  return decodeEntities(spaced.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseImageInput(text: string): ImageInput {
  const t = text.trim();
  if (!t) return INVALID;
  return t.startsWith("<") ? parseHtml(t) : parseUrl(t);
}

function parseHtml(html: string): ImageInput {
  const img = html.match(/<img\b[^>]*>/i)?.[0];
  const src = img ? attr(img, "src") : undefined;
  for (const a of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(a, "href");
    const file = href ? filePage(href) : null;
    if (file) {
      return {
        kind: "wikimedia",
        ...file,
        credit: attr(a, "title") || undefined,
        fallbackSrc: src ? absolute(src) : undefined,
      };
    }
  }
  // A bare <img> — e.g. what a browser's "Copy image" puts on the clipboard.
  return src ? parseUrl(src) : INVALID;
}

function parseUrl(raw: string): ImageInput {
  const u = toUrl(raw);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return INVALID;
  const file = filePage(u.href) ?? mediaFile(u);
  return file ? { kind: "wikimedia", ...file } : { kind: "web", url: u.href };
}

type FileRef = { wiki: string; title: string };

// en.wikipedia.org, en.m.wikipedia.org, commons.wikimedia.org, commons.m.wikimedia.org
const WIKI_HOST = /^(?:([a-z0-9-]+)\.(?:m\.)?wikipedia\.org|commons\.(?:m\.)?wikimedia\.org)$/i;
const FILE_TITLE = /^(?:File|Image):(.+)$/i;

/** A file description page: /wiki/File:X, Article#/media/File:X, or ?title=File:X. */
function filePage(href: string): FileRef | null {
  const u = toUrl(href);
  const host = u?.hostname.match(WIKI_HOST);
  if (!u || !host) return null;
  const wiki = host[1] ? `${host[1].toLowerCase()}.wikipedia.org` : "commons.wikimedia.org";
  const fromHash = u.hash.match(/^#\/media\/(.+)$/)?.[1];
  const fromPath = u.pathname.match(/^\/wiki\/(.+)$/)?.[1];
  const name =
    (fromHash && safeDecode(fromHash).match(FILE_TITLE)?.[1]) ||
    (fromPath && safeDecode(fromPath).match(FILE_TITLE)?.[1]) ||
    // searchParams values are already decoded.
    u.searchParams.get("title")?.match(FILE_TITLE)?.[1];
  return name ? { wiki, title: toTitle(name) } : null;
}

// /wikipedia/<project>/[thumb/]<h>/<hh>/<file>[/<n>px-<file>]
const MEDIA_PATH = /^\/wikipedia\/([a-z0-9-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)(?:\/[^/]*)?$/i;

/** An image URL on upload.wikimedia.org or thumb.wikimedia.org. */
function mediaFile(u: URL): FileRef | null {
  if (!/^(?:upload|thumb)\.wikimedia\.org$/i.test(u.hostname)) return null;
  const m = u.pathname.match(MEDIA_PATH);
  if (!m) return null;
  const project = m[1].toLowerCase();
  const wiki = project === "commons" ? "commons.wikimedia.org" : `${project}.wikipedia.org`;
  return { wiki, title: toTitle(safeDecode(m[2])) };
}

/** The title as the API reports it after normalisation: underscores become spaces. */
const toTitle = (name: string) => `File:${name.replace(/_/g, " ")}`;

const absolute = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

function toUrl(raw: string): URL | null {
  try {
    return new URL(absolute(raw));
  } catch {
    return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Attribute value from a single tag; accepts "…" or '…' quoting. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[1] ?? m[2]) : undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/remote/parseImageInput.test.ts`
Expected: PASS — 31 tests.

- [ ] **Step 5: Commit**

```bash
git add src/remote/parseImageInput.ts src/remote/parseImageInput.test.ts
git commit -m "feat: recognise Wikimedia snippets, links and image URLs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Resolve input to an image

**Files:**
- Create: `src/remote/wikimediaFixtures.ts`
- Create: `src/remote/resolveImage.ts`
- Test: `src/remote/resolveImage.test.ts`

**Interfaces:**
- Consumes (Task 1): `ImageInput`, `htmlToText`, `parseImageInput` (tests only).
- Produces:
  ```ts
  export type FetchJson = (url: string) => Promise<unknown>;
  export type ProbeSize = (url: string) => Promise<{ width: number; height: number }>;
  export interface ResolvedImage {
    url: string; type: ElementType; aspect: number | null;
    naturalW?: number; naturalH?: number; credit?: string; lowRes?: boolean;
  }
  export const REQUEST_WIDTH = 1920;
  export const UNREACHABLE_MESSAGE: string;
  export const PROBE_FAILED_MESSAGE: string;
  export const missingMessage: (title: string) => string;
  export function apiUrl(wiki: string, title: string): string;
  export function stripTracking(url: string): string;
  export function typeFromPath(url: string): ElementType;
  export function buildCredit(info: ImageInfo, viaCommons: boolean): string;
  export function resolveWikimedia(input: WikimediaInput, fetchJson: FetchJson): Promise<ResolvedImage>;
  export function resolveInput(input: ImageInput, deps: { fetchJson: FetchJson; probeSize: ProbeSize }): Promise<ResolvedImage>;
  ```
  `resolveInput` is the only function the UI calls.

Facts this task relies on (verified against the live API on 2026-10-15 — see spec D3):
- Wikimedia serves fixed thumbnail widths; for a 1920 request, any original wider than 1920 comes back as an exact `…/1920px-<name>` thumbnail, a narrower one as the original (`utm_content=thumbnail_unscaled`).
- `thumbwidth`/`thumbheight` in the response echo the request and are wrong for small originals — never read them; read the width from `/<n>px-` in the URL.
- Asking `en.wikipedia.org` about a Commons file returns `missing: true` **with** `imageinfo` and `imagerepository: "shared"`. Only a page without `imageinfo` is truly missing.

- [ ] **Step 1: Add the fixtures**

Create `src/remote/wikimediaFixtures.ts` (trimmed copies of real responses — keep them byte-for-byte; the tests depend on the exact URLs and metadata HTML):

```ts
// Trimmed copies of real Wikimedia API responses (formatversion=2, iiurlwidth=1920),
// captured 2026-10-15. Only the fields resolveWikimedia reads are kept.

export const newton = {
  "query": {
    "pages": [
      {
        "title": "File:Portrait of Sir Isaac Newton, 1689 (brightened).jpg",
        "imagerepository": "local",
        "imageinfo": [
          {
            "width": 2218,
            "height": 2671,
            "mime": "image/jpeg",
            "url": "https://upload.wikimedia.org/wikipedia/commons/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1920px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
            "extmetadata": {
              "Artist": {
                "value": "<bdi><a href=\"https://en.wikipedia.org/wiki/en:Godfrey_Kneller\" class=\"extiw\" title=\"w:en:Godfrey Kneller\"><span title=\"German-born British painter (1646–1723)\">Godfrey Kneller</span></a></bdi>"
              },
              "LicenseShortName": {
                "value": "Public domain"
              }
            }
          }
        ]
      }
    ]
  }
};

export const logoSvg = {
  "query": {
    "pages": [
      {
        "title": "File:Wikipedia-logo-v2.svg",
        "imagerepository": "local",
        "imageinfo": [
          {
            "width": 103,
            "height": 94,
            "mime": "image/svg+xml",
            "url": "https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/1920px-Wikipedia-logo-v2.svg.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
            "extmetadata": {
              "Artist": {
                "value": "Version 1 by <a rel=\"mw:WikiLink/Interwiki\" href=\"https://meta.wikimedia.org/wiki/User:Nohat\" title=\"meta:User:Nohat\" class=\"extiw\">Nohat</a> (concept by <a rel=\"mw:WikiLink/Interwiki\" href=\"https://meta.wikimedia.org/wiki/User:Paullusmagnus\" title=\"meta:User:Paullusmagnus\" class=\"extiw\">Paullusmagnus</a>); Wikimedia."
              },
              "LicenseShortName": {
                "value": "CC BY-SA 3.0"
              }
            }
          }
        ]
      }
    ]
  }
};

export const earthGif = {
  "query": {
    "pages": [
      {
        "title": "File:Rotating earth (large).gif",
        "imagerepository": "local",
        "imageinfo": [
          {
            "width": 400,
            "height": 400,
            "mime": "image/gif",
            "url": "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
            "extmetadata": {
              "Artist": {
                "value": "<a href=\"//commons.wikimedia.org/wiki/User:Marvel\" title=\"User:Marvel\">Marvel</a>"
              },
              "LicenseShortName": {
                "value": "CC BY-SA 3.0"
              }
            }
          }
        ]
      }
    ]
  }
};

export const exampleCommons = {
  "query": {
    "pages": [
      {
        "title": "File:Example.jpg",
        "imagerepository": "local",
        "imageinfo": [
          {
            "width": 172,
            "height": 178,
            "mime": "image/jpeg",
            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
            "extmetadata": {
              "Artist": {
                "value": "<span typeof=\"mw:File\" id=\"mwxA\"><span id=\"mwxQ\"><img resource=\"https://commons.wikimedia.org/wiki/File:Pictogram-voting-question.svg\" src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Pictogram-voting_question.svg/20px-Pictogram-voting_question.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Pictogram-voting_question.svg/40px-Pictogram-voting_question.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"250\" data-file-height=\"250\" data-file-type=\"drawing\" height=\"15\" width=\"15\" class=\"mw-file-element\" id=\"mwxg\"></span></span>"
              },
              "LicenseShortName": {
                "value": "Public domain"
              }
            }
          }
        ]
      }
    ]
  }
};

export const missing = {
  "query": {
    "pages": [
      {
        "title": "File:Does not exist zz.png",
        "missing": true
      }
    ]
  }
};

export const exampleEnwiki = {
  "query": {
    "pages": [
      {
        "title": "File:Example.jpg",
        "imagerepository": "local",
        "imageinfo": [
          {
            "width": 300,
            "height": 300,
            "mime": "image/jpeg",
            "url": "https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
            "extmetadata": {
              "Artist": {
                "value": "<p>Original by <a href=\"//en.wikipedia.org/wiki/User:Gutza\" title=\"User:Gutza\">Gutza</a>, modifications by <a href=\"//en.wikipedia.org/wiki/User:Centrx\" title=\"User:Centrx\">Centrx</a>\n</p>"
              },
              "LicenseShortName": {
                "value": "Cc-by-sa-3.0"
              }
            }
          }
        ]
      }
    ]
  }
};

// A Commons file asked of en.wikipedia.org: "missing" locally, yet imageinfo is present.
export const newtonViaEnwiki = {
  "query": {
    "pages": [
      {
        "title": "File:Portrait of Sir Isaac Newton, 1689 (brightened).jpg",
        "missing": true,
        "imagerepository": "shared",
        "imageinfo": [
          {
            "width": 2218,
            "height": 2671,
            "mime": "image/jpeg",
            "url": "https://upload.wikimedia.org/wikipedia/commons/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=original",
            "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1920px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
            "extmetadata": {
              "Artist": {
                "value": "<bdi><a href=\"https://en.wikipedia.org/wiki/en:Godfrey_Kneller\" class=\"extiw\" title=\"w:en:Godfrey Kneller\"><span title=\"German-born British painter (1646–1723)\">Godfrey Kneller</span></a></bdi>"
              },
              "LicenseShortName": {
                "value": "Public domain"
              }
            }
          }
        ]
      }
    ]
  }
};
```

- [ ] **Step 2: Write the failing test**

Create `src/remote/resolveImage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { parseImageInput, type ImageInput } from "./parseImageInput";
import {
  PROBE_FAILED_MESSAGE,
  UNREACHABLE_MESSAGE,
  apiUrl,
  missingMessage,
  resolveInput,
  resolveWikimedia,
  stripTracking,
  typeFromPath,
  type FetchJson,
  type ProbeSize,
} from "./resolveImage";
import * as fx from "./wikimediaFixtures";

type Wiki = Extract<ImageInput, { kind: "wikimedia" }>;

const NEWTON = "File:Portrait of Sir Isaac Newton, 1689 (brightened).jpg";
const NEWTON_1920 =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1920px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg";
const NEWTON_250 =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg";

const commons = (title: string, extra: Partial<Wiki> = {}): Wiki => ({
  kind: "wikimedia",
  wiki: "commons.wikimedia.org",
  title,
  ...extra,
});

/** A FetchJson that serves one canned response and records the URL it was asked for. */
const serve = (response: unknown) => vi.fn<FetchJson>(async () => response);
const offline: FetchJson = async () => {
  throw new TypeError("Failed to fetch");
};
const noProbe: ProbeSize = async () => {
  throw new Error("probe should not be called");
};

describe("apiUrl", () => {
  it("asks the given wiki for a 1920px rendition with the metadata the credit needs", () => {
    const u = new URL(apiUrl("en.wikipedia.org", NEWTON));
    expect(u.origin + u.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|AttributionRequired",
      iiurlwidth: "1920",
      titles: NEWTON,
    });
  });
});

describe("stripTracking", () => {
  it("removes utm_* parameters and the empty query they leave", () => {
    expect(stripTracking(`${NEWTON_1920}?utm_source=a&utm_campaign=b&utm_content=c`)).toBe(NEWTON_1920);
  });

  it("keeps other parameters and the path's percent-encoding", () => {
    expect(stripTracking("https://x.org/a%2Cb.jpg?w=1&utm_source=a")).toBe("https://x.org/a%2Cb.jpg?w=1");
  });
});

describe("typeFromPath", () => {
  it.each([
    ["https://x.org/a.SVG", "svg"],
    ["https://x.org/a.gif?x=1", "gif"],
    ["https://x.org/a.jpg", "image"],
    ["https://x.org/picture", "image"],
  ])("%s → %s", (url, type) => {
    expect(typeFromPath(url)).toBe(type);
  });
});

describe("resolveWikimedia", () => {
  it("uses the 1920px thumbnail of a large JPEG and builds the credit from metadata", async () => {
    const fetchJson = serve(fx.newton);
    const r = await resolveWikimedia(commons(NEWTON), fetchJson);
    expect(fetchJson).toHaveBeenCalledWith(apiUrl("commons.wikimedia.org", NEWTON));
    expect(r).toEqual({
      url: NEWTON_1920,
      type: "image",
      aspect: 2671 / 2218,
      naturalW: 1920,
      naturalH: 2312,
      credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
    });
  });

  it("prefers the snippet's credit over the metadata", async () => {
    const r = await resolveWikimedia(commons(NEWTON, { credit: "From the snippet" }), serve(fx.newton));
    expect(r.credit).toBe("From the snippet");
  });

  it("keeps an SVG as the original vector file with no natural size", async () => {
    const r = await resolveWikimedia(commons("File:Wikipedia-logo-v2.svg"), serve(fx.logoSvg));
    expect(r).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg",
      type: "svg",
      aspect: 94 / 103,
      credit:
        "Version 1 by Nohat (concept by Paullusmagnus); Wikimedia., CC BY-SA 3.0, via Wikimedia Commons",
    });
  });

  it("uses the original GIF so it keeps animating", async () => {
    const r = await resolveWikimedia(commons("File:Rotating earth (large).gif"), serve(fx.earthGif));
    expect(r).toMatchObject({
      url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif",
      type: "gif",
      aspect: 1,
      naturalW: 400,
      naturalH: 400,
      credit: "Marvel, CC BY-SA 3.0, via Wikimedia Commons",
    });
  });

  it("uses the original when it is narrower than the request, and drops an empty artist", async () => {
    // Example.jpg's Artist is only an icon — it reduces to no text at all.
    const r = await resolveWikimedia(commons("File:Example.jpg"), serve(fx.exampleCommons));
    expect(r).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
      type: "image",
      aspect: 178 / 172,
      naturalW: 172,
      naturalH: 178,
      credit: "Public domain, via Wikimedia Commons",
    });
  });

  it("credits a file hosted on Wikipedia itself as via Wikipedia", async () => {
    const r = await resolveWikimedia(
      { kind: "wikimedia", wiki: "en.wikipedia.org", title: "File:Example.jpg" },
      serve(fx.exampleEnwiki)
    );
    expect(r.credit).toBe("Original by Gutza, modifications by Centrx, Cc-by-sa-3.0, via Wikipedia");
    expect(r.url).toBe("https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg");
  });

  it("resolves a Commons file asked of Wikipedia even though the page reports missing", async () => {
    const r = await resolveWikimedia(
      { kind: "wikimedia", wiki: "en.wikipedia.org", title: NEWTON },
      serve(fx.newtonViaEnwiki)
    );
    expect(r).toMatchObject({
      url: NEWTON_1920,
      naturalW: 1920,
      credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
    });
  });

  it("reports a file that does not exist", async () => {
    await expect(
      resolveWikimedia(commons("File:Does not exist zz.png"), serve(fx.missing))
    ).rejects.toThrow(missingMessage("File:Does not exist zz.png"));
  });

  it("falls back to the snippet's thumbnail when Wikimedia can't be reached", async () => {
    const input = parseImageInput(
      `<a title="Godfrey Kneller, Public domain, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:X.jpg"><img src="${NEWTON_250}?utm_source=a"></a>`
    ) as Wiki;
    expect(await resolveWikimedia(input, offline)).toEqual({
      url: NEWTON_250,
      type: "image",
      aspect: null,
      credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
      lowRes: true,
    });
  });

  it("falls back the same way on a malformed response", async () => {
    const r = await resolveWikimedia(commons(NEWTON, { fallbackSrc: NEWTON_250 }), serve({ error: "x" }));
    expect(r.lowRes).toBe(true);
  });

  it("reports Wikimedia unreachable when there is no fallback", async () => {
    await expect(resolveWikimedia(commons(NEWTON), offline)).rejects.toThrow(UNREACHABLE_MESSAGE);
  });
});

describe("resolveInput", () => {
  it("rejects invalid input with its message", async () => {
    await expect(
      resolveInput({ kind: "invalid", message: "nope" }, { fetchJson: offline, probeSize: noProbe })
    ).rejects.toThrow("nope");
  });

  it("does not probe a Wikimedia image whose size the API gave", async () => {
    const r = await resolveInput(commons(NEWTON), { fetchJson: serve(fx.newton), probeSize: noProbe });
    expect(r.naturalW).toBe(1920);
  });

  it("measures the low-res fallback so it isn't stretched", async () => {
    const r = await resolveInput(commons(NEWTON, { fallbackSrc: NEWTON_250 }), {
      fetchJson: offline,
      probeSize: async () => ({ width: 250, height: 301 }),
    });
    expect(r).toMatchObject({ aspect: 301 / 250, naturalW: 250, naturalH: 301, lowRes: true });
  });

  it("keeps the fallback with unknown aspect if measuring fails too", async () => {
    const r = await resolveInput(commons(NEWTON, { fallbackSrc: NEWTON_250 }), {
      fetchJson: offline,
      probeSize: async () => {
        throw new Error("no");
      },
    });
    expect(r).toMatchObject({ aspect: null, lowRes: true });
  });

  it("measures an ordinary web image", async () => {
    const r = await resolveInput(
      { kind: "web", url: "https://x.org/cat.png?utm_source=keep" },
      { fetchJson: offline, probeSize: async () => ({ width: 800, height: 600 }) }
    );
    expect(r).toEqual({
      url: "https://x.org/cat.png?utm_source=keep",
      type: "image",
      aspect: 0.75,
      naturalW: 800,
      naturalH: 600,
    });
  });

  it("gives a web SVG an aspect but no natural size, and tolerates an unknown size", async () => {
    const svg = await resolveInput(
      { kind: "web", url: "https://x.org/d.svg" },
      { fetchJson: offline, probeSize: async () => ({ width: 200, height: 100 }) }
    );
    expect(svg).toEqual({ url: "https://x.org/d.svg", type: "svg", aspect: 0.5 });
    const unknown = await resolveInput(
      { kind: "web", url: "https://x.org/d.svg" },
      { fetchJson: offline, probeSize: async () => ({ width: 0, height: 0 }) }
    );
    expect(unknown.aspect).toBeNull();
  });

  it("reports a web image that won't load", async () => {
    await expect(
      resolveInput(
        { kind: "web", url: "https://x.org/nothing" },
        {
          fetchJson: offline,
          probeSize: async () => {
            throw new Error("404");
          },
        }
      )
    ).rejects.toThrow(PROBE_FAILED_MESSAGE);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/remote/resolveImage.test.ts`
Expected: FAIL — `Failed to resolve import "./resolveImage"`.

- [ ] **Step 4: Implement**

Create `src/remote/resolveImage.ts`:

```ts
// Turn a parsed input into something the editor can place: the URL to show or download,
// its element type, shape and credit (spec D3–D5, D9). Network access is injected so the
// logic runs under Vitest; the browser implementations live in ./browser.ts.
import type { ElementType } from "../types";
import { htmlToText, type ImageInput } from "./parseImageInput";

export type FetchJson = (url: string) => Promise<unknown>;
/** Pixel size of the image at `url`; 0×0 when the browser can't tell (some SVGs). */
export type ProbeSize = (url: string) => Promise<{ width: number; height: number }>;

export interface ResolvedImage {
  /** What goes in <img src>, or what is downloaded for a copy. */
  url: string;
  type: ElementType;
  /** originalH / originalW; null when unknown. */
  aspect: number | null;
  naturalW?: number;
  naturalH?: number;
  /** undefined → no caption. */
  credit?: string;
  /** The API failed and the snippet's small thumbnail is being used instead. */
  lowRes?: boolean;
}

type WikimediaInput = Extract<ImageInput, { kind: "wikimedia" }>;

/** Wikimedia rounds requests up to 1280 / 1920 / 3840; 1920 is the user's choice (D3). */
export const REQUEST_WIDTH = 1920;

export const UNREACHABLE_MESSAGE = "Couldn't reach Wikimedia — check your connection.";
export const PROBE_FAILED_MESSAGE = "Couldn't load an image from that address.";
export const missingMessage = (title: string) => `Wikimedia has no file called ${title}.`;

export function apiUrl(wiki: string, title: string): string {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|AttributionRequired",
    iiurlwidth: String(REQUEST_WIDTH),
    titles: title,
  });
  return `https://${wiki}/w/api.php?${q}`;
}

/** Drop Wikimedia's utm_* tracking parameters. */
export function stripTracking(url: string): string {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith("utm_")) u.searchParams.delete(key);
  }
  return u.toString();
}

export function typeFromPath(url: string): ElementType {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // not a URL — fall back to the raw string
  }
  const p = path.toLowerCase();
  return p.endsWith(".svg") ? "svg" : p.endsWith(".gif") ? "gif" : "image";
}

const typeFromMime = (mime: string): ElementType =>
  mime === "image/svg+xml" ? "svg" : mime === "image/gif" ? "gif" : "image";

interface ImageInfo {
  width: number;
  height: number;
  mime: string;
  url: string;
  thumburl?: string;
  extmetadata?: Record<string, { value?: unknown } | undefined>;
}

interface ApiPage {
  title?: string;
  missing?: boolean;
  invalid?: boolean;
  imagerepository?: string;
  imageinfo?: ImageInfo[];
}

/** "Artist, Licence, via …" in the form Commons' own snippet uses (D5). */
export function buildCredit(info: ImageInfo, viaCommons: boolean): string {
  const text = (key: string) => {
    const v = info.extmetadata?.[key]?.value;
    return typeof v === "string" ? htmlToText(v) : "";
  };
  const via = viaCommons ? "via Wikimedia Commons" : "via Wikipedia";
  return [text("Artist"), text("LicenseShortName"), via].filter(Boolean).join(", ");
}

export async function resolveWikimedia(input: WikimediaInput, fetchJson: FetchJson): Promise<ResolvedImage> {
  let data: unknown;
  try {
    data = await fetchJson(apiUrl(input.wiki, input.title));
  } catch {
    return fallback(input);
  }
  const page = (data as { query?: { pages?: ApiPage[] } } | null)?.query?.pages?.[0];
  if (!page) return fallback(input);
  const info = page.imageinfo?.[0];
  // A Commons file asked of a Wikipedia is "missing" there yet still has imageinfo;
  // only a page with no imageinfo at all is truly absent.
  if (!info) {
    if (page.missing || page.invalid) throw new Error(missingMessage(input.title));
    return fallback(input);
  }

  const type = typeFromMime(info.mime);
  // SVG: the original stays vector (thumburl is a PNG). GIF: originals keep animating.
  const url = stripTracking(type === "image" && info.thumburl ? info.thumburl : info.url);
  const aspect = info.height / info.width;
  const viaCommons = input.wiki === "commons.wikimedia.org" || page.imagerepository === "shared";
  const resolved: ResolvedImage = {
    url,
    type,
    aspect,
    credit: input.credit ?? buildCredit(info, viaCommons),
  };
  if (type !== "svg") {
    // thumbwidth echoes the request, not the file served — read the width off the URL.
    const px = new URL(url).pathname.match(/\/(\d+)px-[^/]*$/);
    resolved.naturalW = px ? Number(px[1]) : info.width;
    resolved.naturalH = px ? Math.round(resolved.naturalW * aspect) : info.height;
  }
  return resolved;
}

function fallback(input: WikimediaInput): ResolvedImage {
  if (!input.fallbackSrc) throw new Error(UNREACHABLE_MESSAGE);
  return {
    url: stripTracking(input.fallbackSrc),
    type: typeFromPath(input.fallbackSrc),
    aspect: null,
    credit: input.credit,
    lowRes: true,
  };
}

/** Everything the dialog needs from one input. Throws Error with a user-facing message. */
export async function resolveInput(
  input: ImageInput,
  deps: { fetchJson: FetchJson; probeSize: ProbeSize }
): Promise<ResolvedImage> {
  if (input.kind === "invalid") throw new Error(input.message);

  if (input.kind === "wikimedia") {
    const r = await resolveWikimedia(input, deps.fetchJson);
    if (r.aspect !== null) return r;
    // The low-res fallback has no dimensions; measure it so it isn't stretched.
    try {
      return { ...r, ...measured(await deps.probeSize(r.url), r.type) };
    } catch {
      return r;
    }
  }

  let size: { width: number; height: number };
  try {
    size = await deps.probeSize(input.url);
  } catch {
    throw new Error(PROBE_FAILED_MESSAGE);
  }
  const type = typeFromPath(input.url);
  return { url: input.url, type, ...measured(size, type) };
}

function measured(size: { width: number; height: number }, type: ElementType) {
  const known = size.width > 0 && size.height > 0;
  return {
    aspect: known ? size.height / size.width : null,
    ...(known && type !== "svg" ? { naturalW: size.width, naturalH: size.height } : {}),
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/remote`
Expected: PASS — 2 files, 56 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/remote/wikimediaFixtures.ts src/remote/resolveImage.ts src/remote/resolveImage.test.ts
git commit -m "feat: resolve web images through the Wikimedia API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Layout, settings type and store actions

**Files:**
- Create: `src/remote/layoutWebImage.ts`
- Modify: `src/types.ts` (the `PresentationSettings` interface, ~line 80)
- Modify: `src/store/store.ts` (imports, `AppState` interface, actions next to `setBackground`/`addElement`)
- Test: `src/remote/layoutWebImage.test.ts`, `src/store/webImages.test.ts`

**Interfaces:**
- Consumes (Task 2): `ResolvedImage`.
- Produces:
  ```ts
  // src/remote/layoutWebImage.ts
  export const WEB_IMAGE_WIDTH = 400;
  export interface WebImageLayout {
    image: Partial<Element>;
    caption?: { content: string; extra: Partial<Element> };
  }
  export const escapeText: (s: string) => string;
  export function layoutWebImage(r: ResolvedImage, center: { cx: number; cy: number }): WebImageLayout;
  // src/types.ts
  export type WebImagesMode = "link" | "copy";
  // src/store/store.ts
  export interface NewElement { type: ElementType; content: string; extra?: Partial<Element> }
  // on useStore.getState():
  addElements: (items: NewElement[]) => string[];   // one undo step; selects the first
  setWebImagesDefault: (mode: WebImagesMode) => void; // no-op if unchanged
  ```

- [ ] **Step 1: Write the failing layout test**

Create `src/remote/layoutWebImage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { layoutWebImage } from "./layoutWebImage";
import type { ResolvedImage } from "./resolveImage";

const newton: ResolvedImage = {
  url: "https://thumb.wikimedia.org/x/1920px-n.jpg",
  type: "image",
  aspect: 2671 / 2218,
  naturalW: 1920,
  naturalH: 2312,
  credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
};

describe("layoutWebImage", () => {
  it("centres a 400-wide image with the original's proportions", () => {
    const { image } = layoutWebImage(newton, { cx: 1000, cy: 500 });
    expect(image).toEqual({ x: 800, y: 259, w: 400, h: 482, naturalW: 1920, naturalH: 2312 });
  });

  it("puts a grey caption directly under the image, as wide as it", () => {
    const { caption } = layoutWebImage(newton, { cx: 1000, cy: 500 });
    expect(caption).toEqual({
      content: "Godfrey Kneller, Public domain, via Wikimedia Commons",
      extra: {
        x: 800,
        y: 259 + 482 + 7,
        w: 400,
        h: 42,
        textStyle: { fontSize: 14, fontWeight: 400, color: "#6b6b73", align: "left" },
      },
    });
  });

  it("escapes HTML in the credit", () => {
    const { caption } = layoutWebImage({ ...newton, credit: "A & B <i>" }, { cx: 0, cy: 0 });
    expect(caption?.content).toBe("A &amp; B &lt;i&gt;");
  });

  it("adds no caption without a credit", () => {
    expect(layoutWebImage({ ...newton, credit: undefined }, { cx: 0, cy: 0 }).caption).toBeUndefined();
  });

  it("falls back to 400×300 and no natural size when the shape is unknown", () => {
    const { image } = layoutWebImage({ url: "u", type: "svg", aspect: null }, { cx: 0, cy: 0 });
    expect(image).toEqual({ x: -200, y: -150, w: 400, h: 300 });
  });
});
```

- [ ] **Step 2: Write the failing store test**

Create `src/store/webImages.test.ts`. The store autosaves to IndexedDB, which Node lacks, so the test mocks `./persistence` (`vi.mock` is hoisted above the imports by Vitest):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import { makePresentation } from "./factory";

// The store autosaves to IndexedDB, which Node lacks; replace persistence with no-ops.
// (vi.mock is hoisted above the imports.)
vi.mock("./persistence", () => ({
  debounce: () => () => {},
  saveLocal: async () => {},
}));

const undo = () => useStore.temporal.getState().undo();

beforeEach(() => {
  useStore.getState().loadPresentation(makePresentation());
  useStore.temporal.getState().clear();
});

describe("addElements", () => {
  it("adds an image and its caption in one undo step, selecting the image", () => {
    const ids = useStore.getState().addElements([
      { type: "image", content: "https://x.org/a.jpg", extra: { x: 10, y: 20, w: 400, h: 482 } },
      { type: "text", content: "Credit", extra: { x: 10, y: 509, w: 400, h: 42 } },
    ]);
    const st = useStore.getState();
    expect(st.presentation.elements.map((e) => [e.id, e.type, e.content, e.x, e.y])).toEqual([
      [ids[0], "image", "https://x.org/a.jpg", 10, 20],
      [ids[1], "text", "Credit", 10, 509],
    ]);
    expect(st.presentation.elements.map((e) => e.z)).toEqual([0, 1]);
    expect(st.selectedIds).toEqual([ids[0]]);

    undo();
    expect(useStore.getState().presentation.elements).toEqual([]);
  });

  it("stacks new elements above existing ones", () => {
    useStore.getState().addElement("text", "existing");
    useStore.getState().addElements([{ type: "image", content: "u" }, { type: "text", content: "c" }]);
    expect(useStore.getState().presentation.elements.map((e) => e.z)).toEqual([0, 1, 2]);
  });

  it("centres an element on the view when no position is given", () => {
    useStore.getState().setEditorCamera({ cx: 1000, cy: 500, scale: 1, rotation: 0 });
    useStore.getState().addElements([{ type: "image", content: "u", extra: { w: 400, h: 300 } }]);
    const [el] = useStore.getState().presentation.elements;
    expect([el.x, el.y]).toEqual([800, 350]);
  });
});

describe("setWebImagesDefault", () => {
  it("defaults to link and records a change", () => {
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
    useStore.getState().setWebImagesDefault("copy");
    expect(useStore.getState().presentation.settings.webImages).toBe("copy");
    undo();
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
  });

  it("writes nothing when the value is unchanged, so undo history stays clean", () => {
    useStore.getState().setWebImagesDefault("link");
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
    expect(useStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/remote/layoutWebImage.test.ts src/store/webImages.test.ts`
Expected: FAIL — `Failed to resolve import "./layoutWebImage"`, and in the store test `addElements is not a function` / `setWebImagesDefault is not a function`.

- [ ] **Step 4: Implement the layout**

Create `src/remote/layoutWebImage.ts`:

```ts
// Where a web image and its credit caption land on the canvas (spec D6, D7).
import type { Element } from "../types";
import type { ResolvedImage } from "./resolveImage";

/** Same default width as an uploaded image (makeElement). */
export const WEB_IMAGE_WIDTH = 400;
const UNKNOWN_ASPECT_HEIGHT = 300;
const CAPTION_COLOR = "#6b6b73";

export interface WebImageLayout {
  image: Partial<Element>;
  caption?: { content: string; extra: Partial<Element> };
}

/** Text-box content is HTML, so a credit like "A & B <x>" must be escaped. */
export const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function layoutWebImage(r: ResolvedImage, center: { cx: number; cy: number }): WebImageLayout {
  const w = WEB_IMAGE_WIDTH;
  const h = r.aspect ? Math.round(w * r.aspect) : UNKNOWN_ASPECT_HEIGHT;
  const x = center.cx - w / 2;
  const y = center.cy - h / 2;
  const image: Partial<Element> = { x, y, w, h };
  if (r.naturalW && r.naturalH) {
    image.naturalW = r.naturalW;
    image.naturalH = r.naturalH;
  }
  if (!r.credit) return { image };

  const fontSize = Math.max(10, Math.round(w * 0.035));
  return {
    image,
    caption: {
      content: escapeText(r.credit),
      extra: {
        x,
        y: y + h + Math.round(fontSize * 0.5),
        w,
        h: Math.round(fontSize * 3),
        textStyle: { fontSize, fontWeight: 400, color: CAPTION_COLOR, align: "left" },
      },
    },
  };
}
```

- [ ] **Step 5: Add the settings field**

In `src/types.ts`, replace:

```ts
export interface PresentationSettings {
  defaultEasing: EasingPreset;
  defaultDuration: number | "auto";
}
```

with:

```ts
export type WebImagesMode = "link" | "copy";

export interface PresentationSettings {
  defaultEasing: EasingPreset;
  defaultDuration: number | "auto";
  /**
   * Default for "+ From web": link to the image or save a copy in the project. Absent
   * means "link" — never written until the user picks, so old saves need no migration.
   */
  webImages?: WebImagesMode;
}
```

- [ ] **Step 6: Add the store actions**

In `src/store/store.ts` make these four edits.

(a) Replace the types import:

```ts
import type { Element, ElementType, Frame, Presentation } from "../types";
```

with:

```ts
import type { Element, ElementType, Frame, Presentation, WebImagesMode } from "../types";
```

(b) Directly after `export type Mode = "edit" | "play";` add:

```ts

export interface NewElement {
  type: ElementType;
  content: string;
  extra?: Partial<Element>;
}
```

(c) In `interface AppState`, replace:

```ts
  setBackground: (color: string) => void;

  addElement: (type: ElementType, content: string, extra?: Partial<Element>) => string;
```

with:

```ts
  setBackground: (color: string) => void;
  /** Remember link-or-copy for "+ From web". No-op (and no history entry) if unchanged. */
  setWebImagesDefault: (mode: WebImagesMode) => void;

  addElement: (type: ElementType, content: string, extra?: Partial<Element>) => string;
  /** Add several elements as ONE undo step; selects the first. Returns ids in order. */
  addElements: (items: NewElement[]) => string[];
```

(d) In the store body, insert `setWebImagesDefault` immediately before `addElement: (type, content, extra) => {`, and `addElements` immediately after `addElement`'s closing `},` (i.e. before `updateElement: (id, patch) =>`):

```ts
      setWebImagesDefault: (mode) =>
        set((st) => {
          if ((st.presentation.settings.webImages ?? "link") === mode) return;
          st.presentation.settings.webImages = mode;
          touch(st.presentation);
        }),
```

```ts
      addElements: (items) => {
        const els = items.map((it) => makeElement(it.type, { content: it.content, ...it.extra }));
        set((st) => {
          let z = nextZ(st.presentation.elements);
          els.forEach((el, i) => {
            el.z = z++;
            if (items[i].extra?.x === undefined) el.x = st.editorCamera.cx - el.w / 2;
            if (items[i].extra?.y === undefined) el.y = st.editorCamera.cy - el.h / 2;
            st.presentation.elements.push(el);
          });
          if (els.length) st.selectedIds = [els[0].id];
          touch(st.presentation);
        });
        return els.map((el) => el.id);
      },
```

`setWebImagesDefault` returning early leaves the immer draft untouched, so the presentation keeps its identity and zundo records no history entry — that is what the "writes nothing" test checks.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: PASS — 8 files, 107 tests; typecheck prints nothing.

- [ ] **Step 8: Commit**

```bash
git add src/remote/layoutWebImage.ts src/remote/layoutWebImage.test.ts src/types.ts src/store/store.ts src/store/webImages.test.ts
git commit -m "feat: lay out web images with credit captions in one undo step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Store a copy (the asset seam)

**Files:**
- Create: `src/store/assets.ts`
- Create: `src/remote/copyRemote.ts`
- Modify: `src/components/Toolbar.tsx` (remove `fileToDataUrl`, use `blobToDataUrl`)
- Test: `src/remote/copyRemote.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // src/store/assets.ts — browser-only (FileReader)
  export const blobToDataUrl: (blob: Blob) => Promise<string>;
  export function storeImageBlob(blob: Blob, _nameHint: string): Promise<string>;
  // src/remote/copyRemote.ts
  export const COPY_BLOCKED_MESSAGE: string;
  export const NOT_AN_IMAGE_MESSAGE: string;
  export const isRemoteUrl: (content: string) => boolean;
  export function hostOf(url: string): string;
  export function nameHintFromUrl(url: string): string;
  export function copyRemoteImage(url: string): Promise<string>; // throws Error(user message)
  ```
  `storeImageBlob` is the single integration point with the asset-folders branch (spec §9): when that branch lands, folder mode calls its `addAsset` here. Do not add folder logic now. `_nameHint` is unused today; the underscore keeps `noUnusedParameters` quiet.

- [ ] **Step 1: Write the failing test**

Create `src/remote/copyRemote.test.ts`. `storeImageBlob` needs `FileReader`, so it is mocked; the mock function must be created with `vi.hoisted` because `vi.mock` runs before the imports:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPY_BLOCKED_MESSAGE,
  NOT_AN_IMAGE_MESSAGE,
  copyRemoteImage,
  hostOf,
  isRemoteUrl,
  nameHintFromUrl,
} from "./copyRemote";

// storeImageBlob uses FileReader (browser-only); record what it is given instead.
// vi.mock is hoisted above the imports, so the mock fn must be created with vi.hoisted.
const { storeImageBlob } = vi.hoisted(() => ({
  storeImageBlob: vi.fn(async (_blob: Blob, nameHint: string) => `stored:${nameHint}`),
}));
vi.mock("../store/assets", () => ({ storeImageBlob }));

const NEWTON_1920 =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1920px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg";

const respond = (body: BlobPart, type: string, status = 200) =>
  vi.fn(async () => new Response(new Blob([body], { type }), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  storeImageBlob.mockClear();
});

describe("copyRemoteImage", () => {
  it("downloads the image and stores it under a readable name", async () => {
    vi.stubGlobal("fetch", respond("jpegbytes", "image/jpeg"));
    expect(await copyRemoteImage(NEWTON_1920)).toBe(
      "stored:1920px-Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"
    );
    const [blob] = storeImageBlob.mock.calls[0];
    expect(blob.type).toBe("image/jpeg");
    expect(await blob.text()).toBe("jpegbytes");
  });

  it("reports a blocked or offline download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(copyRemoteImage(NEWTON_1920)).rejects.toThrow(COPY_BLOCKED_MESSAGE);
    expect(storeImageBlob).not.toHaveBeenCalled();
  });

  it("reports an HTTP error the same way", async () => {
    vi.stubGlobal("fetch", respond("nope", "text/html", 404));
    await expect(copyRemoteImage(NEWTON_1920)).rejects.toThrow(COPY_BLOCKED_MESSAGE);
  });

  it("refuses something that is not an image", async () => {
    vi.stubGlobal("fetch", respond("<html>", "text/html"));
    await expect(copyRemoteImage("https://x.org/page")).rejects.toThrow(NOT_AN_IMAGE_MESSAGE);
    expect(storeImageBlob).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("recognises linked content", () => {
    expect(isRemoteUrl("https://x.org/a.png")).toBe(true);
    expect(isRemoteUrl("HTTP://x.org/a.png")).toBe(true);
    expect(isRemoteUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isRemoteUrl("assets/a.png")).toBe(false);
  });

  it("names the host", () => {
    expect(hostOf(NEWTON_1920)).toBe("thumb.wikimedia.org");
  });

  it("falls back to 'image' when the URL has no file name", () => {
    expect(nameHintFromUrl("https://x.org/")).toBe("image");
    expect(nameHintFromUrl("not a url")).toBe("image");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/remote/copyRemote.test.ts`
Expected: FAIL — `Failed to resolve import "./copyRemote"`.

- [ ] **Step 3: Create the seam**

Create `src/store/assets.ts`:

```ts
// Where image bytes go when an image is stored in the project (web-images spec D1).
// Today that is a data URI, exactly as an upload produces. When the asset-folders work
// lands, storeImageBlob writes a file in folder mode instead — this is the one seam.

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Returns the value to put in Element.content for a stored image. */
export function storeImageBlob(blob: Blob, _nameHint: string): Promise<string> {
  return blobToDataUrl(blob);
}
```

- [ ] **Step 4: Implement copying**

Create `src/remote/copyRemote.ts`:

```ts
// "Save a copy": download a web image and store it in the project (spec D1, D9).
import { storeImageBlob } from "../store/assets";

export const COPY_BLOCKED_MESSAGE = "This site doesn't allow copying — add it as a link instead.";
export const NOT_AN_IMAGE_MESSAGE = "That address didn't return an image.";

export const isRemoteUrl = (content: string) => /^https?:\/\//i.test(content);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The URL's last path segment, decoded — a readable name for the stored file. */
export function nameHintFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "image";
  } catch {
    return "image";
  }
}

export async function copyRemoteImage(url: string): Promise<string> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    // CORS refusals and being offline both surface as a TypeError from fetch.
    throw new Error(COPY_BLOCKED_MESSAGE);
  }
  if (!blob.type.startsWith("image/")) throw new Error(NOT_AN_IMAGE_MESSAGE);
  return storeImageBlob(blob, nameHintFromUrl(url));
}
```

- [ ] **Step 5: Point uploads at the shared helper**

In `src/components/Toolbar.tsx`:

(a) After `import { exportHtml } from "../export/exportHtml";` add:

```ts
import { blobToDataUrl } from "../store/assets";
```

(b) Delete the local helper (and the blank line after it):

```ts
const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
```

(c) In `onAddAsset`, replace `const url = await fileToDataUrl(f);` with `const url = await blobToDataUrl(f);`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: PASS — 9 files, 114 tests; typecheck prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/store/assets.ts src/remote/copyRemote.ts src/remote/copyRemote.test.ts src/components/Toolbar.tsx
git commit -m "feat: copy web images into the project through one storage seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The *+ From web* dialog and paste-to-add

**Files:**
- Create: `src/remote/browser.ts`
- Create: `src/components/WebImageDialog.tsx`
- Modify: `src/components/Toolbar.tsx` (prop + button)
- Modify: `src/App.tsx` (dialog state, paste listener, render)
- Modify: `src/styles.css` (after `.modal h2 { margin-top: 0; }`)

**Interfaces:**
- Consumes: `parseImageInput` (Task 1); `resolveInput`, `ResolvedImage`, `FetchJson`, `ProbeSize` (Task 2); `layoutWebImage` (Task 3); `useStore().addElements`, `setWebImagesDefault`, `editorCamera`, `presentation.settings.webImages` (Task 3); `copyRemoteImage` (Task 4).
- Produces: `WebImageDialog({ initialText: string; onClose: () => void })`; `Toolbar` now requires an `onAddFromWeb: () => void` prop.

There is no DOM test environment, so this task is verified by typecheck, build and the manual checks in Step 6.

- [ ] **Step 1: Browser network functions**

Create `src/remote/browser.ts`:

```ts
// Browser implementations of the network seams in resolveImage.ts.
import type { FetchJson, ProbeSize } from "./resolveImage";

export const fetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** Load the image to learn its size. Displaying needs no CORS, so this works anywhere. */
export const probeSize: ProbeSize = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
```

- [ ] **Step 2: The dialog**

Create `src/components/WebImageDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import { parseImageInput } from "../remote/parseImageInput";
import { resolveInput, type ResolvedImage } from "../remote/resolveImage";
import { fetchJson, probeSize } from "../remote/browser";
import { copyRemoteImage } from "../remote/copyRemote";
import { layoutWebImage } from "../remote/layoutWebImage";

type Status =
  | { kind: "empty" }
  | { kind: "resolving" }
  | { kind: "error"; message: string }
  | { kind: "ready"; image: ResolvedImage };

const RESOLVE_DELAY_MS = 400;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "+ From web": paste a Wikimedia snippet/link or an image URL, preview, add (spec §4 UI). */
export function WebImageDialog({ initialText, onClose }: { initialText: string; onClose: () => void }) {
  const webDefault = useStore((s) => s.presentation.settings.webImages ?? "link");
  const [text, setText] = useState(initialText);
  const [copy, setCopy] = useState(webDefault === "copy");
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Resolve once typing pauses; the cleanup discards any older in-flight result.
  useEffect(() => {
    if (!text.trim()) {
      setStatus({ kind: "empty" });
      return;
    }
    const input = parseImageInput(text);
    if (input.kind === "invalid") {
      setStatus({ kind: "error", message: input.message });
      return;
    }
    let stale = false;
    setStatus({ kind: "resolving" });
    const timer = setTimeout(() => {
      resolveInput(input, { fetchJson, probeSize }).then(
        (image) => !stale && setStatus({ kind: "ready", image }),
        (e: unknown) => !stale && setStatus({ kind: "error", message: messageOf(e) })
      );
    }, RESOLVE_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async () => {
    if (status.kind !== "ready") return;
    const r = status.image;
    setAdding(true);
    setAddError(null);
    let content = r.url;
    if (copy) {
      try {
        content = await copyRemoteImage(r.url);
      } catch (e) {
        // Clear the box so the next click on Add links the image instead (spec D9).
        setAddError(messageOf(e));
        setCopy(false);
        setAdding(false);
        return;
      }
    }
    const { editorCamera, setWebImagesDefault, addElements } = useStore.getState();
    const layout = layoutWebImage(r, editorCamera);
    // Before addElements, so the first undo after Add removes the image and its caption.
    setWebImagesDefault(copy ? "copy" : "link");
    addElements([
      { type: r.type, content, extra: layout.image },
      ...(layout.caption ? [{ type: "text" as const, ...layout.caption }] : []),
    ]);
    onClose();
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal web-image-dialog">
        <h2>Add an image from the web</h2>
        <textarea
          autoFocus
          rows={4}
          value={text}
          placeholder="Paste a Wikimedia link, the embed snippet from “Use this file on the web”, or an image URL"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="web-image-status">
          {status.kind === "resolving" && <span className="hint">Looking up…</span>}
          {status.kind === "error" && <span className="error">{status.message}</span>}
          {status.kind === "ready" && (
            <div className="web-image-preview">
              <img src={status.image.url} alt="" />
              <div>
                {status.image.credit && <div>{status.image.credit}</div>}
                {status.image.naturalW && (
                  <div className="hint">
                    {status.image.naturalW} × {status.image.naturalH} px
                  </div>
                )}
                {status.image.lowRes && (
                  <div className="error">Low resolution — Wikimedia couldn't be reached</div>
                )}
              </div>
            </div>
          )}
        </div>
        <label className="web-image-copy">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Save a copy in the project
        </label>
        {addError && <div className="error">{addError}</div>}
        <div className="web-image-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={status.kind !== "ready" || adding} onClick={add}>
            {adding ? "Downloading…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Notes on the code above, so you don't "fix" it:
- `setWebImagesDefault` is called **before** `addElements`; it is a separate history entry, so the first undo after *Add* removes image and caption together.
- On a failed copy the checkbox is cleared and the dialog stays open — one more click on *Add* links the image (spec D9).
- `stale` discards results for text that has since changed (Review Focus 2).

- [ ] **Step 3: Toolbar button**

In `src/components/Toolbar.tsx`:

(a) Replace `export function Toolbar() {` with:

```tsx
export function Toolbar({ onAddFromWeb }: { onAddFromWeb: () => void }) {
```

(b) Directly after the line `<button onClick={() => fileRef.current?.click()}>+ Image / GIF / SVG</button>` add:

```tsx
        <button onClick={onAddFromWeb} title="Add an image from Wikimedia or any web address">
          + From web
        </button>
```

- [ ] **Step 4: Dialog state and paste listener in the editor**

In `src/App.tsx`:

(a) Replace `import { useEffect, useState } from "react";` with:

```tsx
import { useCallback, useEffect, useState } from "react";
```

(b) After `import { PresenterView } from "./components/PresenterView";` add:

```tsx
import { WebImageDialog } from "./components/WebImageDialog";
import { parseImageInput } from "./remote/parseImageInput";
```

(c) In `Editor`, after `const [showPicker, setShowPicker] = useState(false);` add:

```tsx
  /** null = closed; otherwise the text the web-image dialog opens with. */
  const [webDialog, setWebDialog] = useState<string | null>(null);
  const closeWebDialog = useCallback(() => setWebDialog(null), []);
```

(d) Immediately before `if (!booted) return null;` (hooks must stay above the early returns) add:

```tsx
  // Pasting an image link or Commons snippet onto the canvas opens the web-image dialog.
  useEffect(() => {
    if (mode !== "edit" || showPicker || webDialog !== null) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      const html = e.clipboardData?.getData("text/html") ?? "";
      const text = /<(a|img)\b/i.test(html) ? html : (e.clipboardData?.getData("text/plain") ?? "");
      if (parseImageInput(text).kind === "invalid") return;
      e.preventDefault();
      setWebDialog(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [mode, showPicker, webDialog]);

```

(e) Replace `<Toolbar />` with:

```tsx
      <Toolbar onAddFromWeb={() => setWebDialog("")} />
```

(f) Immediately before `{showPicker && (` add:

```tsx
      {webDialog !== null && <WebImageDialog initialText={webDialog} onClose={closeWebDialog} />}
```

- [ ] **Step 5: Styles**

In `src/styles.css`, directly after `.modal h2 { margin-top: 0; }` add:

```css

/* ---- Web image dialog ---- */
.error { color: var(--danger); font-size: 12px; }
.web-image-dialog textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }
.web-image-status { min-height: 24px; margin: 10px 0; font-size: 13px; }
.web-image-dialog .hint { color: var(--muted); font-size: 12px; }
.web-image-preview { display: flex; gap: 12px; align-items: flex-start; }
.web-image-preview img { max-width: 180px; max-height: 180px; border-radius: 4px; background: #fff; }
.web-image-copy { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); }
.web-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
```

- [ ] **Step 6: Verify**

Run: `npx tsc -b --noEmit && npx vitest run && npx vite build`
Expected: typecheck silent; 9 files / 114 tests pass; build ends with `✓ built in …`.

Then `npx vite --port 5191 --strictPort` (a port other than 5173 keeps this origin's IndexedDB separate from the user's real autosave) and open `http://localhost:5191/` in Chrome. Choose *Blank canvas*. Check:

a. *+ From web*, paste the Newton snippet from spec §8 → within ~1 s a preview, the credit *Godfrey Kneller, Public domain, via Wikimedia Commons* and *1920 × 2312 px*. Tick *Save a copy*, click *Add* → a 400×482 portrait with the caption directly beneath; in DevTools the `<img>` `src` starts with `data:image/jpeg`.
b. Click *+ Text*, click into the new text box, paste any URL with ⌘V → it is pasted as text; no dialog opens. (Review Focus 1)
c. Open *+ From web*, paste `https://commons.wikimedia.org/wiki/File:Wikipedia-logo-v2.svg`, then immediately replace it with `https://en.wikipedia.org/wiki/File:Example.jpg` → the final preview is Example.jpg (a small photo) and stays so; the SVG never replaces it. (Review Focus 2)
d. Untick *Save a copy* (this changes the project default), *Add* → press ⌘Z once with nothing focused → image **and** caption disappear together. (Review Focus 4)
e. Find any image URL on a site without CORS headers (e.g. an image on a small personal site; check DevTools → Network → no `access-control-allow-origin`). Open the dialog, paste it, tick *Save a copy*, *Add* → the message *This site doesn't allow copying — add it as a link instead.* appears and the box unticks; *Add* again → the image is added (linked), with no caption. (Review Focus 3)
f. With nothing focused, paste `https://en.wikipedia.org/wiki/Isaac_Newton#/media/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg` → the dialog opens pre-filled and resolves.
g. Type `hello` in the dialog → *Paste a Wikimedia link, its embed snippet, or an image URL.* and *Add* disabled. *Escape* closes the dialog.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/remote/browser.ts src/components/WebImageDialog.tsx src/components/Toolbar.tsx src/App.tsx src/styles.css
git commit -m "feat: add images from the web via dialog or paste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: *Save a copy* for linked images

**Files:**
- Modify: `src/components/PropertiesPanel.tsx`

**Interfaces:**
- Consumes (Task 4): `copyRemoteImage`, `hostOf`, `isRemoteUrl`; `useStore().updateElement`.
- Produces: nothing used elsewhere.

- [ ] **Step 1: Imports**

In `src/components/PropertiesPanel.tsx`:

(a) Make the first line:

```tsx
import { useState } from "react";
```

(followed by the existing `import { useStore } from "../store/store";`).

(b) Before `import type { Element, EnterEffect, ExitEffect, SlideDirection } from "../types";` add:

```tsx
import { copyRemoteImage, hostOf, isRemoteUrl } from "../remote/copyRemote";
```

- [ ] **Step 2: Show the field for linked images**

In `ElementProps`, immediately before `<h3 style={{ marginTop: 14 }}>Lifecycle</h3>` add:

```tsx
      {el.type !== "text" && isRemoteUrl(el.content) && <LinkedImageField id={id} url={el.content} />}

```

- [ ] **Step 3: The field component**

Immediately before `function FrameProps({ id }: { id: string | null }) {` add:

```tsx
/** A linked web image: say where it comes from, and offer to store a copy (spec §4 UI). */
function LinkedImageField({ id, url }: { id: string; url: string }) {
  const update = useStore((s) => s.updateElement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCopy = async () => {
    setBusy(true);
    setError(null);
    try {
      update(id, { content: await copyRemoteImage(url) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>Linked from {hostOf(url)} — needs internet to show</label>
      <button disabled={busy} onClick={saveCopy}>
        {busy ? "Downloading…" : "Save a copy"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

```

- [ ] **Step 4: Verify**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: typecheck silent; 114 tests pass.

Manual (dev server on 5191 as in Task 5): add the Newton snippet **without** *Save a copy*; with the image selected the panel shows *Linked from thumb.wikimedia.org — needs internet to show* and *Save a copy*. Click it → the label disappears and the `<img>` `src` becomes `data:image/jpeg…`. ⌘Z restores the link. An uploaded image or a text element shows no such field.

- [ ] **Step 5: Commit**

```bash
git add src/components/PropertiesPanel.tsx
git commit -m "feat: convert a linked web image to a stored copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation and manual checklist

**Files:**
- Modify: `docs/USER_MANUAL.md` (§3 *Adding content*, §9, §11, §12)
- Modify: `fixtures/README.md` (append a section)

**Interfaces:** none.

- [ ] **Step 1: Adding content (§3)**

In `docs/USER_MANUAL.md`, replace:

```markdown
- **+ Image / GIF / SVG** — file picker (PNG, JPG, WebP, GIF, SVG). You can select several
  at once. Assets are embedded into the project, so everything stays self-contained.
```

with:

```markdown
- **+ Image / GIF / SVG** — file picker (PNG, JPG, WebP, GIF, SVG). You can select several
  at once. Assets are embedded into the project, so everything stays self-contained.
- **+ From web** — paste an image from the web:
  - the HTML snippet Wikimedia Commons gives under *Use this file on the web* (best: it
    carries the credit line),
  - a Wikipedia or Commons file link (`…/wiki/File:…`, or an article link ending in
    `#/media/File:…`),
  - a Wikimedia image address (including the small thumbnails you get by copying an image
    off Wikipedia), or
  - any other image URL.

  For Wikimedia images pres-sure fetches a **1920px** version (or the original, if smaller;
  SVGs and GIFs always come as the original) and adds a **credit caption** underneath —
  *Artist, Licence, via Wikimedia Commons*. Most Commons images are CC BY-SA and require
  that credit; the caption is an ordinary text box you can move, restyle or delete.

  **Save a copy in the project** decides how the image is kept:
  - unticked (**linked**, the default) — the deck stores only the address and the image is
    loaded from the web whenever it is shown. Keeps projects small; needs internet.
  - ticked (**copy**) — the image is downloaded into the project, like an upload. Works
    offline. Some sites refuse copying; pres-sure then says so and you can link instead.

  The choice you add with becomes the project's default for next time. A linked image's
  properties panel says where it is linked from and offers **Save a copy** to convert it.
  You can also simply **paste** (<kbd>⌘/Ctrl + V</kbd>) a link or snippet onto the canvas —
  the same dialog opens, filled in.
```

- [ ] **Step 2: Export note (§9)**

Replace:

```markdown
  internet and no dependency on this editor** — the shareable deliverable. Text uses a
  system-font stack for portability.
```

with:

```markdown
  internet and no dependency on this editor** — the shareable deliverable. Text uses a
  system-font stack for portability. **Exception:** images added from the web as *linked*
  are loaded from their web address, so they need internet; offline they show as broken
  images. Use *Save a copy* on them first if the file must work offline.
```

- [ ] **Step 3: Shortcut (§11)**

In the **Editor** shortcut table, after the row `| <kbd>Esc</kbd> | Deselect |` add:

```markdown
| <kbd>Ctrl/⌘ + V</kbd> on the canvas | Paste an image link or Commons snippet → *+ From web* |
```

- [ ] **Step 4: Tip (§12)**

After the bullet that begins `- **Use SVG for anything you'll zoom into hard**` (it spans two lines) add:

```markdown
- **Credit what you borrow.** Images from Wikimedia arrive with a credit caption; keep it
  (or move all credits to a closing slide) — most Commons licences require it.
```

- [ ] **Step 5: Manual checklist**

Append to `fixtures/README.md`:

```markdown

## Web images (no fixture file)

Checks for `docs/superpowers/specs/2026-10-14-web-images-design.md`. Run the editor on a
spare port so its autosave doesn't touch your real deck: `npx vite --port 5191`.

1. *+ From web* → paste the Newton snippet (spec §8) → preview, credit and *1920 × 2312 px*;
   *Add* → portrait with correct proportions and the caption beneath; one ⌘Z removes both.
2. Zoom into the portrait until it fills the screen — no blur hint.
3. Paste `https://en.wikipedia.org/wiki/Isaac_Newton#/media/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg`
   → resolves; credit built from metadata.
4. Paste `https://commons.wikimedia.org/wiki/File:Wikipedia-logo-v2.svg` → stays sharp at
   deep zoom.
5. With *Save a copy* ticked → *Save .json* shows a `data:` URI for that image; reopen the
   dialog → the box is still ticked.
6. A linked image's properties panel shows *Linked from upload.wikimedia.org* (or
   `thumb.wikimedia.org`); *Save a copy* converts it.
7. ⌘V a snippet onto the canvas with nothing selected → dialog opens pre-filled. ⌘V inside
   a text box → normal paste.
8. *Export .html* with one linked and one copied image → both show online; with the network
   off only the copied one shows.
9. A non-Wikimedia image URL from a site without CORS → linking works; copying reports
   *This site doesn't allow copying — add it as a link instead.*
```

- [ ] **Step 6: Run the checklist**

Run checks 1–9 above in Chrome. Note any failure in your report with what you saw.

- [ ] **Step 7: Commit**

```bash
git add docs/USER_MANUAL.md fixtures/README.md
git commit -m "docs: document adding images from the web

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After all tasks

- `npx vitest run` → 9 files, 114 tests pass. `npx tsc -b --noEmit` → silent. `npx vite build` → succeeds.
- Do not merge. Integration with `asset-folders` (spec §9) is a separate, later step: whichever branch merges second makes `storeImageBlob` call `addAsset` in folder mode.
