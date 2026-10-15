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
