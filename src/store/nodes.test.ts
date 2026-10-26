// Rung and scene-node mutations, driven through the real store (§2.3, scale ladder).
// The promote/cascade cases are the ones worth pinning: a node's local units vanish when
// it is deleted, and everything expressed in them has to be converted or it moves.
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_TEXT_STYLE, makeElement, makeFrame, makePresentation } from "./factory";
import { useStore } from "./store";
import { resolveTransform, worldRect } from "../nodes/transform";
import type { Presentation, Rung, SceneNode } from "../types";

const st = () => useStore.getState();
const nodes = () => st().presentation.nodes ?? [];
const nodeById = (id: string) => nodes().find((n) => n.id === id)!;
const elById = (id: string) => st().presentation.elements.find((e) => e.id === id)!;

const node = (
  id: string,
  parentId: string | null,
  x = 0,
  y = 0,
  scale = 1,
  rungId = "r"
): SceneNode => ({ id, parentId, rungId, x, y, scale });

const rung = (id: string, name = id): Rung => ({ id, name });

/** Load a hand-built deck, then drop the history entry the load itself made. */
const load = (partial: Partial<Presentation> = {}) => {
  st().loadPresentation({ ...makePresentation(), ...partial });
  useStore.temporal.getState().clear();
};

// The store subscribes a debounced autosave to IndexedDB, which this environment has
// none of. Fake timers keep that 500 ms timer from ever firing, so a mutation here cannot
// turn into an unhandled rejection whose timing depends on how long the suite runs.
beforeAll(() => void vi.useFakeTimers());
afterAll(() => void vi.useRealTimers());

beforeEach(() => load());

describe("rungs", () => {
  test("addRung appends to the ladder and returns its id", () => {
    const world = st().addRung("world");
    const site = st().addRung("site");
    expect(st().presentation.rungs?.map((r) => r.name)).toEqual(["world", "site"]);
    expect(st().presentation.rungs?.map((r) => r.id)).toEqual([world, site]);
  });

  test("addRung creates the ladder on a deck that has none", () => {
    expect(st().presentation.rungs).toBeUndefined();
    st().addRung("world");
    expect(st().presentation.rungs).toHaveLength(1);
  });

  test("renameRung renames in place", () => {
    const id = st().addRung("wrld");
    st().renameRung(id, "world");
    expect(st().presentation.rungs).toEqual([{ id, name: "world" }]);
  });

  test("removeRung leaves nodes intact but clears the label", () => {
    load({
      rungs: [rung("r1", "world"), rung("r2", "site")],
      nodes: [node("w", null, 0, 0, 1, "r1"), node("s", "w", 0, 0, 1, "r2")],
    });
    st().removeRung("r1");
    expect(st().presentation.rungs?.map((r) => r.id)).toEqual(["r2"]);
    expect(nodes().map((n) => n.id)).toEqual(["w", "s"]);
    expect(nodeById("w").rungId).toBe("");
    expect(nodeById("s").rungId).toBe("r2");
  });

  test("removing the last rung leaves the deck with no rungs key", () => {
    const id = st().addRung("world");
    st().removeRung(id);
    expect("rungs" in st().presentation).toBe(false);
  });
});

describe("nodes", () => {
  test("addNode defaults to the root parent and scale 1", () => {
    const id = st().addNode({ rungId: "r" });
    expect(nodeById(id)).toEqual({ id, parentId: null, rungId: "r", x: 0, y: 0, scale: 1 });
  });

  test("addNode writes an explicit null parent even when handed undefined", () => {
    // childrenOf finds the world's children by `parentId === null`, so an absent or
    // undefined parent would hide the node from the root walk entirely.
    const id = st().addNode({ rungId: "r", parentId: undefined });
    expect(nodeById(id).parentId).toBeNull();
  });

  test("addNode creates the node tree on a deck that has none", () => {
    expect(st().presentation.nodes).toBeUndefined();
    const id = st().addNode({ rungId: "r" });
    expect(nodes().map((n) => n.id)).toEqual([id]);
  });

  test("updateNode patches position and scale", () => {
    const id = st().addNode({ rungId: "r" });
    st().updateNode(id, { x: 10, y: 20, scale: 2 });
    expect(nodeById(id)).toMatchObject({ x: 10, y: 20, scale: 2 });
  });

  test("mutations on unknown ids are no-ops", () => {
    load({ nodes: [node("w", null)] });
    expect(() => {
      st().updateNode("ghost", { x: 5 });
      st().removeNode("ghost", "promote");
      st().renameRung("ghost", "x");
      st().removeRung("ghost");
      st().moveElementToNode("ghost", "w");
    }).not.toThrow();
    expect(nodes().map((n) => n.id)).toEqual(["w"]);
  });
});

describe("removeNode in promote mode", () => {
  // w(scale 2) > i(5,7,scale 3) > s(11,13,scale 5)
  const ladder = () => [node("w", null, 0, 0, 2), node("i", "w", 5, 7, 3), node("s", "i", 11, 13, 5)];

  test("reparents children and keeps their world transform", () => {
    load({ nodes: ladder() });
    const before = resolveTransform(nodes(), "s");
    st().removeNode("i", "promote");
    expect(nodes().map((n) => n.id)).toEqual(["w", "s"]);
    expect(nodeById("s").parentId).toBe("w");
    expect(resolveTransform(nodes(), "s")).toEqual(before);
  });

  test("moves the node's own elements to its parent, keeping world rect", () => {
    const el = makeElement("image", { content: "x", nodeId: "i", x: 11, y: 13, w: 20, h: 8 });
    load({ nodes: ladder(), elements: [el] });
    const before = worldRect(el, nodes());
    st().removeNode("i", "promote");
    expect(elById(el.id).nodeId).toBe("w");
    expect(worldRect(elById(el.id), nodes())).toEqual(before);
  });

  test("folds the removed node's scale into a text element's font size", () => {
    // fontSize is in local units like x/y/w/h, so the conversion has to reach it too —
    // otherwise the box stays put while the glyphs inside it resize.
    const el = makeElement("text", {
      content: "x",
      nodeId: "i",
      textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 36 },
    });
    load({ nodes: ladder(), elements: [el] });
    st().removeNode("i", "promote");
    expect(elById(el.id).textStyle!.fontSize).toBe(108);
  });

  test("promoting out of a root-parented node leaves the element with no nodeId", () => {
    const el = makeElement("image", { content: "x", nodeId: "w", x: 3, y: 4, w: 10, h: 6 });
    load({ nodes: [node("w", null, 5, 7, 3)], elements: [el] });
    const before = worldRect(el, nodes());
    st().removeNode("w", "promote");
    expect("nodeId" in elById(el.id)).toBe(false);
    expect(worldRect(elById(el.id), nodes())).toEqual(before);
  });

  test("out of a self-parented node, reparents its children to the world", () => {
    // A self-parent is reachable from a buggy reparent (nothing rejects it) and from
    // hand-edited JSON. Folding into `parentId` unchecked would leave the child parented
    // to the very node being deleted — an orphan rendering at the root at full size.
    load({ nodes: [node("w", "w", 5, 7, 3), node("c", "w", 1, 1, 2)] });
    st().removeNode("w", "promote");
    expect(nodeById("c").parentId).toBeNull();
  });

  test("out of a node whose parent is missing, leaves no element pointing at the deleted node", () => {
    const el = makeElement("image", { content: "x", nodeId: "w", x: 1, y: 1, w: 4, h: 2 });
    load({ nodes: [node("w", "ghost", 5, 7, 3)], elements: [el] });
    st().removeNode("w", "promote");
    expect("nodeId" in elById(el.id)).toBe(false);
  });

  test("is a single undo entry", () => {
    load({ nodes: ladder() });
    st().removeNode("i", "promote");
    expect(useStore.temporal.getState().pastStates).toHaveLength(1);
    useStore.temporal.getState().undo();
    expect(nodes().map((n) => n.id)).toEqual(["w", "i", "s"]);
    expect(nodeById("s").parentId).toBe("i");
  });
});

describe("removeNode in cascade mode", () => {
  test("deletes descendants and their elements", () => {
    const inW = makeElement("image", { content: "w", nodeId: "w" });
    const inI = makeElement("image", { content: "i", nodeId: "i" });
    const inS = makeElement("image", { content: "s", nodeId: "s" });
    load({
      nodes: [node("w", null), node("i", "w"), node("s", "i")],
      elements: [inW, inI, inS],
    });
    st().removeNode("i", "cascade");
    expect(nodes().map((n) => n.id)).toEqual(["w"]);
    expect(st().presentation.elements.map((e) => e.id)).toEqual([inW.id]);
  });

  test("drops deleted elements from the selection", () => {
    const inI = makeElement("image", { content: "i", nodeId: "i" });
    load({ nodes: [node("w", null), node("i", "w")], elements: [inI] });
    st().select([inI.id]);
    st().removeNode("i", "cascade");
    expect(st().selectedIds).toEqual([]);
  });

  test("removing the last node leaves the deck with no nodes key", () => {
    load({ nodes: [node("w", null)] });
    st().removeNode("w", "cascade");
    expect("nodes" in st().presentation).toBe(false);
  });
});

describe("removeNode and the rest of the deck", () => {
  test("clears a currentNodeId that pointed into the deleted subtree", () => {
    load({ nodes: [node("w", null), node("i", "w"), node("s", "i")] });
    st().setCurrentNode("s");
    st().removeNode("i", "cascade");
    expect(st().currentNodeId).toBe("w");
  });

  test("promote keeps a frame taken at the node, unlabelled", () => {
    const f = makeFrame({ x: 0, y: 0, w: 100, h: 50, nodeId: "i" });
    load({ nodes: [node("w", null, 0, 0, 2), node("i", "w", 5, 7, 3)], frames: [f] });
    st().removeNode("i", "promote");
    expect(st().presentation.frames.map((x) => x.id)).toEqual([f.id]);
    expect("nodeId" in st().presentation.frames[0]).toBe(false);
  });

  test("cascade keeps a frame taken inside the deleted subtree, unlabelled", () => {
    const f = makeFrame({ x: 0, y: 0, w: 100, h: 50, nodeId: "s" });
    load({ nodes: [node("w", null), node("i", "w"), node("s", "i")], frames: [f] });
    st().removeNode("i", "cascade");
    expect(st().presentation.frames.map((x) => x.id)).toEqual([f.id]);
    expect("nodeId" in st().presentation.frames[0]).toBe(false);
  });
});

describe("moveElementToNode", () => {
  test("rewrites local coords so the element does not jump", () => {
    const el = makeElement("image", { content: "x", x: 100, y: 50, w: 20, h: 10 });
    load({ nodes: [node("a", null, 100, 100, 2)], elements: [el] });
    const before = worldRect(el, nodes());
    st().moveElementToNode(el.id, "a");
    expect(elById(el.id).nodeId).toBe("a");
    expect(elById(el.id)).toMatchObject({ x: 0, y: -25, w: 10, h: 5 });
    expect(worldRect(elById(el.id), nodes())).toEqual(before);
  });

  test("converts a text element's font size into the destination's units", () => {
    const el = makeElement("text", {
      content: "x",
      textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 48 },
    });
    load({ nodes: [node("a", null, 0, 0, 2)], elements: [el] });
    st().moveElementToNode(el.id, "a");
    expect(elById(el.id).textStyle!.fontSize).toBe(24);
  });

  test("moving back to the world removes the nodeId rather than writing null", () => {
    const el = makeElement("image", { content: "x", nodeId: "a", x: 10, y: 5, w: 20, h: 8 });
    load({ nodes: [node("a", null, 100, 100, 2)], elements: [el] });
    const before = worldRect(el, nodes());
    st().moveElementToNode(el.id, null);
    expect("nodeId" in elById(el.id)).toBe(false);
    expect(worldRect(elById(el.id), nodes())).toEqual(before);
  });

  test("a zero-scale destination leaves the element's geometry finite", () => {
    const el = makeElement("image", { content: "x", x: 10, y: 5, w: 20, h: 8 });
    load({ nodes: [node("z", null, 0, 0, 0)], elements: [el] });
    st().moveElementToNode(el.id, "z");
    const moved = elById(el.id);
    expect([moved.x, moved.y, moved.w, moved.h].every(Number.isFinite)).toBe(true);
  });
});

describe("the current node", () => {
  test("setCurrentNode records the node the author is working in", () => {
    st().setCurrentNode("i");
    expect(st().currentNodeId).toBe("i");
  });

  test("setCurrentNode is not an undo entry", () => {
    st().setCurrentNode("i");
    expect(useStore.temporal.getState().pastStates).toHaveLength(0);
  });

  test("loading a presentation leaves no stale current node", () => {
    st().setCurrentNode("i");
    st().loadPresentation(makePresentation());
    expect(st().currentNodeId).toBeNull();
  });
});
