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
