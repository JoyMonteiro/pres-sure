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
