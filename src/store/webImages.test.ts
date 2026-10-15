import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import { makePresentation } from "./factory";

// The store autosaves to IndexedDB, which Node lacks; replace persistence with no-ops.
// (vi.mock is hoisted above the imports.)
vi.mock("./persistence", () => ({
  debounce: () => () => {},
  saveLocal: async () => {},
}));

const undo = () => useStore.temporal.getState().undo();

beforeEach(() => {
  useStore.getState().loadPresentation(makePresentation());
  useStore.temporal.getState().clear();
});

describe("addElements", () => {
  it("adds an image and its caption in one undo step, selecting the image", () => {
    const ids = useStore.getState().addElements([
      { type: "image", content: "https://x.org/a.jpg", extra: { x: 10, y: 20, w: 400, h: 482 } },
      { type: "text", content: "Credit", extra: { x: 10, y: 509, w: 400, h: 42 } },
    ]);
    const st = useStore.getState();
    expect(st.presentation.elements.map((e) => [e.id, e.type, e.content, e.x, e.y])).toEqual([
      [ids[0], "image", "https://x.org/a.jpg", 10, 20],
      [ids[1], "text", "Credit", 10, 509],
    ]);
    expect(st.presentation.elements.map((e) => e.z)).toEqual([0, 1]);
    expect(st.selectedIds).toEqual([ids[0]]);

    undo();
    expect(useStore.getState().presentation.elements).toEqual([]);
  });

  it("stacks new elements above existing ones", () => {
    useStore.getState().addElement("text", "existing");
    useStore.getState().addElements([{ type: "image", content: "u" }, { type: "text", content: "c" }]);
    expect(useStore.getState().presentation.elements.map((e) => e.z)).toEqual([0, 1, 2]);
  });

  it("centres an element on the view when no position is given", () => {
    useStore.getState().setEditorCamera({ cx: 1000, cy: 500, scale: 1, rotation: 0 });
    useStore.getState().addElements([{ type: "image", content: "u", extra: { w: 400, h: 300 } }]);
    const [el] = useStore.getState().presentation.elements;
    expect([el.x, el.y]).toEqual([800, 350]);
  });
});

describe("setWebImagesDefault", () => {
  it("defaults to link and records a change", () => {
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
    useStore.getState().setWebImagesDefault("copy");
    expect(useStore.getState().presentation.settings.webImages).toBe("copy");
    undo();
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
  });

  it("writes nothing when the value is unchanged, so undo history stays clean", () => {
    useStore.getState().setWebImagesDefault("link");
    expect(useStore.getState().presentation.settings.webImages).toBeUndefined();
    expect(useStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
