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
  it("treats names differing only in case as a clash (APFS and NTFS ignore case)", () => {
    const existing = new Map([
      ["Keeling.png", "h1"],
      ["KEELING-2.png", "h2"],
    ]);
    expect(chooseAssetName("keeling.png", "h3", existing)).toEqual({ name: "keeling-3.png", reused: false });
  });
});

describe("sha256Hex", () => {
  it("hashes blobs and buffers identically", async () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256Hex(new Blob(["abc"]))).toBe(expected);
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(expected);
  });
});
