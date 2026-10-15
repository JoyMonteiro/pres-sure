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
