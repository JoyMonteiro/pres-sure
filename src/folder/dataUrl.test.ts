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
