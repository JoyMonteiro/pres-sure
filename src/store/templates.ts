// Starter templates — narrative skeletons that beat the blank canvas (§4.8).
import type { Presentation } from "../types";
import { makeElement, makeFrame, makePresentation } from "./factory";

export interface Template {
  id: string;
  name: string;
  description: string;
  build: () => Presentation;
}

const textEl = (content: string, x: number, y: number, w = 600, fontSize = 64) => {
  const e = makeElement("text", { content });
  e.x = x;
  e.y = y;
  e.w = w;
  e.h = fontSize * 2.2;
  e.textStyle = { fontSize, fontWeight: 700, color: "#18181b", align: "center" };
  return e;
};

function framesFromElements(p: Presentation, margin = 0.25) {
  p.frames = p.elements.map((el, i) => {
    const padX = el.w * margin;
    const padY = el.h * margin;
    return makeFrame({
      x: el.x - padX,
      y: el.y - padY,
      w: el.w + padX * 2,
      h: el.h + padY * 2,
      title: `Frame ${i + 1}`,
    });
  });
}

export const TEMPLATES: Template[] = [
  {
    id: "journey",
    name: "Journey / path",
    description: "A left-to-right path of beats — good for stories and timelines.",
    build: () => {
      const p = makePresentation("A journey");
      p.elements = [
        textEl("Start here", 0, 0),
        textEl("Then this happens", 1400, 300),
        textEl("And then this", 2800, -200),
        textEl("Finally, the payoff", 4200, 200),
      ];
      framesFromElements(p);
      return p;
    },
  },
  {
    id: "hub",
    name: "Hub & spokes",
    description: "A central idea with surrounding details you zoom out to and back from.",
    build: () => {
      const p = makePresentation("Hub & spokes");
      const hub = textEl("The big idea", 0, 0, 800, 80);
      const spokes = [
        textEl("Point A", -1400, -900, 500, 48),
        textEl("Point B", 1400, -900, 500, 48),
        textEl("Point C", -1400, 900, 500, 48),
        textEl("Point D", 1400, 900, 500, 48),
      ];
      p.elements = [hub, ...spokes];
      // Overview frame first, then each spoke, returning to hub feel via overview beat.
      p.frames = [
        makeFrame({ x: -2000, y: -1400, w: 4000, h: 2800, title: "Overview" }),
        ...spokes.map((s, i) =>
          makeFrame({ x: s.x - 150, y: s.y - 120, w: s.w + 300, h: s.h + 240, title: `Point ${"ABCD"[i]}` })
        ),
      ];
      return p;
    },
  },
  {
    id: "grid",
    name: "Grid",
    description: "A 3×2 grid of cells — methodical, catalog-style walkthroughs.",
    build: () => {
      const p = makePresentation("Grid");
      const cols = 3;
      const cw = 1200;
      const ch = 800;
      p.elements = Array.from({ length: 6 }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return textEl(`Cell ${i + 1}`, c * cw, r * ch, 500, 56);
      });
      framesFromElements(p, 0.15);
      return p;
    },
  },
];

export const blankPresentation = (): Presentation => makePresentation();
