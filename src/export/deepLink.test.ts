import { describe, expect, it } from "vitest";
import { frameFromHash, frameHashes, titleSlug } from "./deepLink";

describe("titleSlug", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(titleSlug("L3: Keeling Curve")).toBe("l3-keeling-curve");
  });
  it("strips accents and surrounding punctuation", () => {
    expect(titleSlug("  Café — Résumé!  ")).toBe("cafe-resume");
  });
});

describe("frameHashes", () => {
  it("uses the title slug", () => {
    expect(frameHashes(["Intro", "L2 Isotherms"])).toEqual(["intro", "l2-isotherms"]);
  });
  it("falls back to the 1-based number for empty titles", () => {
    expect(frameHashes(["Intro", "", "!!"])).toEqual(["intro", "2", "3"]);
  });
  it("gives a repeated slug to the first frame only", () => {
    expect(frameHashes(["Map", "map", "Map"])).toEqual(["map", "2", "3"]);
  });
  it("numbers frames whose slug is all digits, so they cannot shadow a frame number", () => {
    expect(frameHashes(["1850", "Now"])).toEqual(["1", "now"]);
  });
});

describe("frameFromHash", () => {
  const hashes = frameHashes(["Intro", "L2 Isotherms", "", "L3 Keeling Curve"]);

  it("matches a title slug", () => {
    expect(frameFromHash("#l2-isotherms", hashes)).toBe(1);
    expect(frameFromHash("#l3-keeling-curve", hashes)).toBe(3);
  });
  it("matches a 1-based frame number", () => {
    expect(frameFromHash("#1", hashes)).toBe(0);
    expect(frameFromHash("#3", hashes)).toBe(2);
  });
  it("matches a frame by number even when it has a title", () => {
    expect(frameFromHash("#2", hashes)).toBe(1);
  });
  it("tolerates case and percent-encoding", () => {
    expect(frameFromHash("#L2-Isotherms", hashes)).toBe(1);
    expect(frameFromHash("#l2%2Disotherms", hashes)).toBe(1);
  });
  it("returns -1 for empty, unknown or out-of-range hashes", () => {
    expect(frameFromHash("", hashes)).toBe(-1);
    expect(frameFromHash("#", hashes)).toBe(-1);
    expect(frameFromHash("#nope", hashes)).toBe(-1);
    expect(frameFromHash("#0", hashes)).toBe(-1);
    expect(frameFromHash("#5", hashes)).toBe(-1);
    expect(frameFromHash("#%E0%A4%A", hashes)).toBe(-1);
  });
});
