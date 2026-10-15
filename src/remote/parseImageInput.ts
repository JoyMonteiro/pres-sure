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
