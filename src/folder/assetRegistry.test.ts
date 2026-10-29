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
