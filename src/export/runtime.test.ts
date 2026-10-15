import { describe, expect, it } from "vitest";
import { runtimeScript } from "./runtime";
import { frameHashes } from "../playback/deepLink";

// Runs the exported player against just enough of a fake DOM to watch its URL handling.
function boot(titles: string[], hash: string) {
  const frames = titles.map((title, i) => ({
    id: `f${i}`, title, x: i * 1000, y: 0, w: 1000, h: 500, rotation: 0,
    duration: 0, easing: "cut", notes: "",
  }));
  const node = () => ({
    style: {} as Record<string, string>,
    appendChild() {}, addEventListener() {}, animate: () => ({}),
  });
  const els: Record<string, ReturnType<typeof node>> = {
    stage: node(), world: node(), progress: node(),
  };
  const listeners: Record<string, () => void> = {};
  const keys: ((e: { key: string; preventDefault(): void }) => void)[] = [];
  const location = { hash };
  const window = {
    __PRES__: { frames, elements: [] },
    innerWidth: 1000, innerHeight: 500,
    matchMedia: () => ({ matches: true }),
    addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
  };
  const document = {
    getElementById: (id: string) => els[id],
    createElement: node,
    addEventListener: (_: string, fn: (typeof keys)[number]) => keys.push(fn),
  };
  const history = {
    replaceState: (_s: unknown, _t: string, url: string) => { location.hash = url; },
  };
  new Function("window", "document", "history", "location", runtimeScript())(
    window, document, history, location,
  );
  return {
    location,
    /** Camera x-centre, which identifies the frame on screen (frames sit 1000px apart). */
    frame: () => {
      const m = /translate\((-?[\d.]+)px,[^)]*\)$/.exec(els.world.style.transform);
      return (-Number(m![1]) - 500) / 1000;
    },
    key: (key: string) => keys.forEach((fn) => fn({ key, preventDefault() {} })),
    navigate: (h: string) => { location.hash = h; listeners.hashchange(); },
  };
}

const titles = ["Intro", "L2 Isotherms", "", "L3 Keeling Curve", "Intro"];

describe("export runtime deep links", () => {
  it("opens on the first frame with no hash", () => {
    expect(boot(titles, "").frame()).toBe(0);
  });
  it("opens on the frame named by a title slug or number", () => {
    expect(boot(titles, "#l3-keeling-curve").frame()).toBe(3);
    expect(boot(titles, "#3").frame()).toBe(2);
  });
  it("ignores an unknown hash", () => {
    expect(boot(titles, "#nope").frame()).toBe(0);
  });
  it("writes each frame's hash as you navigate, matching deepLink.ts", () => {
    const deck = boot(titles, "");
    const seen = titles.map(() => {
      deck.key("ArrowRight");
      return deck.location.hash;
    });
    const [, a, b, c, d] = frameHashes(titles).map((h) => `#${h}`);
    expect(seen).toEqual([a, b, c, d, d]); // the last press stays on the last frame
    expect(seen).toEqual(["#l2-isotherms", "#3", "#l3-keeling-curve", "#5", "#5"]);
  });
  it("follows a hash change while the deck is open", () => {
    const deck = boot(titles, "");
    deck.navigate("#l2-isotherms");
    expect(deck.frame()).toBe(1);
  });
});
