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
