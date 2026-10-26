import { describe, expect, test } from "vitest";
import { DEFAULT_TEXT_STYLE, makeElement } from "../store/factory";
import type { Element, SceneNode } from "../types";
import { buildLayers, layerTransform } from "./layers";

const n = (id: string, parentId: string | null, x = 0, y = 0, scale = 1): SceneNode =>
  ({ id, parentId, rungId: "r", x, y, scale });
const el = (patch: Partial<Element> = {}): Element => ({ ...makeElement("text", { content: "x" }), ...patch });

describe("buildLayers", () => {
  test("buildLayers puts root-nodeId elements in the root layer", () => {
    const a = el();
    const root = buildLayers([a], []);
    expect(root.node).toBe(null);
    expect(root.elements.map((e) => e.id)).toEqual([a.id]);
    expect(root.children).toEqual([]);
  });

  test("buildLayers nests layers to match the node tree", () => {
    const nodes = [n("w", null), n("i", "w")];
    const atW = el({ nodeId: "w" });
    const atI = el({ nodeId: "i" });
    const atRoot = el();
    const root = buildLayers([atRoot, atW, atI], nodes);
    expect(root.elements.map((e) => e.id)).toEqual([atRoot.id]);
    expect(root.children.map((c) => c.node!.id)).toEqual(["w"]);
    const w = root.children[0];
    expect(w.elements.map((e) => e.id)).toEqual([atW.id]);
    expect(w.children.map((c) => c.node!.id)).toEqual(["i"]);
    expect(w.children[0].elements.map((e) => e.id)).toEqual([atI.id]);
  });

  test("buildLayers places an element with an unknown nodeId in the root layer", () => {
    // Review Focus 1: a typo must not drop the element
    const ghost = el({ nodeId: "ghost" });
    const root = buildLayers([ghost], [n("w", null)]);
    expect(root.elements.map((e) => e.id)).toEqual([ghost.id]);
    expect(root.children[0].elements).toEqual([]);
  });

  test("buildLayers places an element inside a cycle at the root", () => {
    // a cyclic node renders nowhere, so its elements must still reach the root
    const stuck = el({ nodeId: "a" });
    const root = buildLayers([stuck], [n("a", "b"), n("b", "a")]);
    expect(root.elements.map((e) => e.id)).toEqual([stuck.id]);
    expect(root.children).toEqual([]);
  });

  test("buildLayers keeps z-order within a layer", () => {
    const hi = el({ z: 5 });
    const lo = el({ z: 1 });
    const mid = el({ z: 3 });
    const root = buildLayers([hi, lo, mid], []);
    expect(root.elements.map((e) => e.z)).toEqual([1, 3, 5]);
  });
});

describe("layerTransform", () => {
  test("layerTransform emits translate then scale, in that order", () => {
    expect(layerTransform(n("a", null, 10, 20, 2))).toBe("translate(10px, 20px) scale(2)");
  });
});

describe("the font-size acceptance criterion", () => {
  test("a text element deep in the tree keeps its local fontSize", () => {
    // The acceptance criterion from the spec: node scale reaches the DOM as a transform,
    // never as a multiplied font size. At ITC's world scale of 150, a 36px heading must
    // still be 36 in the model — a 5,400px font is the bug this feature exists to remove.
    const nodes = [n("w", null, 0, 0, 150)];
    const heading = el({ nodeId: "w", textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 36 } });
    const root = buildLayers([heading], nodes);
    const placed = root.children[0].elements[0];
    expect(placed.textStyle!.fontSize).toBe(36);
    expect(layerTransform(nodes[0])).toContain("scale(150)");
  });
});
