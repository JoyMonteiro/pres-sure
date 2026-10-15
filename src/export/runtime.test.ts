import { describe, expect, it } from "vitest";
import { runtimeScript } from "./runtime";
import { frameHashes } from "./deepLink";
import { buildHtml } from "./exportHtml";

// Runs the exported player against just enough of a fake DOM to watch its URL handling.
function boot(titles: string[], hash: string, { easing = "cut", reduced = true } = {}) {
  const frames = titles.map((title, i) => ({
    id: `f${i}`, title, x: i * 1000, y: 0, w: 1000, h: 500, rotation: 0,
    duration: easing === "cut" ? 0 : 500, easing, notes: "",
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
    matchMedia: () => ({ matches: reduced }),
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
  // Animation frames are queued, not run, so a test can look at the camera mid-flight.
  let queued: ((now: number) => void)[] = [];
  const requestAnimationFrame = (fn: (now: number) => void) => queued.push(fn);
  const cancelAnimationFrame = () => { queued = []; };
  new Function(
    "window", "document", "history", "location", "requestAnimationFrame", "cancelAnimationFrame",
    runtimeScript(),
  )(window, document, history, location, requestAnimationFrame, cancelAnimationFrame);
  const flush = (now: number) => { const q = queued; queued = []; q.forEach((fn) => fn(now)); };
  return {
    location,
    /** Camera x-centre, which identifies the frame on screen (frames sit 1000px apart). */
    frame: () => {
      const m = /translate\((-?[\d.]+)px,[^)]*\)$/.exec(els.world.style.transform);
      return (-Number(m![1]) - 500) / 1000;
    },
    key: (key: string) => keys.forEach((fn) => fn({ key, preventDefault() {} })),
    navigate: (h: string) => { location.hash = h; listeners.hashchange(); },
    world: els.world,
    /** Run queued frames until the camera lands (each frame jumps far past any duration). */
    settle: () => { for (let i = 0; i < 10 && queued.length; i++) flush(performance.now() + 1e6); },
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

// A permanent will-change:transform makes Chrome keep the raster scale it first painted at,
// so a deep zoom stays blurry. The hint may only be present while the camera is moving.
describe("export runtime rasterisation", () => {
  it("hints will-change only while the camera moves", () => {
    const deck = boot(titles, "", { easing: "smooth", reduced: false });
    expect(deck.world.style.willChange).not.toBe("transform");
    deck.key("ArrowRight");
    expect(deck.world.style.willChange).toBe("transform");
    deck.settle();
    expect(deck.frame()).toBe(1);
    expect(deck.world.style.willChange).toBe("auto");
  });
  it("never hints will-change on a cut", () => {
    const deck = boot(titles, "");
    deck.key("ArrowRight");
    expect(deck.world.style.willChange).not.toBe("transform");
  });
  it("does not pin a raster scale on elements or in the page CSS", () => {
    expect(runtimeScript()).not.toMatch(/willChange='opacity/);
    const deck = {
      id: "p", title: "t", createdAt: 0, updatedAt: 0, world: { backgroundColor: "#fff" },
      elements: [], frames: [], settings: { defaultEasing: "smooth" as const, defaultDuration: "auto" as const },
    };
    expect(buildHtml(deck).split("<script>")[0]).not.toMatch(/will-change/);
  });
});
