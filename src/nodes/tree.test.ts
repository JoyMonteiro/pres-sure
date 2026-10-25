import { describe, expect, test } from "vitest";
import { makeElement, makeFrame, makePresentation } from "../store/factory";
import type { Presentation, Rung, SceneNode } from "../types";
import { ancestorChain, childrenOf, descendantIds, unusedRungs } from "./tree";

const n = (id: string, parentId: string | null, rungId = "r"): SceneNode =>
  ({ id, parentId, rungId, x: 0, y: 0, scale: 1 });
const node = (id: string, parentId: string | null, rungId: string): SceneNode =>
  n(id, parentId, rungId);
const r = (name: string): Rung => ({ id: name, name });
const elAt = (nodeId: string) => makeElement("text", { content: "x", nodeId });
const presWith = (partial: Partial<Presentation>): Presentation =>
  ({ ...makePresentation(), ...partial });

describe("ancestorChain", () => {
  test("ancestorChain is root-first and inclusive", () => {
    const nodes = [n("w", null), n("i", "w"), n("s", "i")];
    expect(ancestorChain(nodes, "s").map((x) => x.id)).toEqual(["w", "i", "s"]);
  });

  test("ancestorChain is empty for root and for an unknown id", () => {
    expect(ancestorChain([], null)).toEqual([]);
    expect(ancestorChain([n("w", null)], "ghost")).toEqual([]);
  });

  test("ancestorChain terminates on a cycle", () => {
    expect(ancestorChain([n("a", "b"), n("b", "a")], "a")).toEqual([]);
  });
});

describe("childrenOf", () => {
  test("childrenOf(null) returns root-parented nodes", () => {
    const nodes = [n("w", null), n("i", "w"), n("x", null)];
    expect(childrenOf(nodes, null).map((c) => c.id)).toEqual(["w", "x"]);
  });

  test("childrenOf returns only direct children", () => {
    const nodes = [n("w", null), n("i", "w"), n("s", "i")];
    expect(childrenOf(nodes, "w").map((c) => c.id)).toEqual(["i"]);
  });
});

describe("descendantIds", () => {
  test("descendantIds is deep and excludes the node itself", () => {
    const nodes = [n("w", null), n("i", "w"), n("s", "i")];
    expect(descendantIds(nodes, "w").sort()).toEqual(["i", "s"]);
  });

  test("descendantIds terminates on a cycle and still excludes the node", () => {
    expect(descendantIds([n("a", "b"), n("b", "a")], "a")).toEqual(["b"]);
  });
});

describe("unusedRungs", () => {
  test("unusedRungs reports a declared rung nothing sits at", () => {
    // the design's finding: five rungs named, four built
    const pres = presWith({
      rungs: [r("world"), r("region"), r("site")],
      nodes: [node("w", null, "world"), node("s", "w", "site")],
      elements: [elAt("w"), elAt("s")],
    });
    expect(unusedRungs(pres).map((x) => x.name)).toEqual(["region"]);
  });

  test("unusedRungs reports a rung whose nodes are empty", () => {
    const pres = presWith({
      rungs: [r("world"), r("site")],
      nodes: [node("w", null, "world"), node("s", "w", "site")],
      elements: [elAt("w")],
    });
    expect(unusedRungs(pres).map((x) => x.name)).toEqual(["site"]);
  });

  test("a frame at a node counts as content, like an element", () => {
    const pres = presWith({
      rungs: [r("world"), r("site")],
      nodes: [node("w", null, "world"), node("s", "w", "site")],
      elements: [elAt("w")],
      frames: [makeFrame({ x: 0, y: 0, w: 1, h: 1, nodeId: "s" })],
    });
    expect(unusedRungs(pres)).toEqual([]);
  });

  test("a deck with no ladder has no unused rungs", () => {
    expect(unusedRungs(makePresentation())).toEqual([]);
  });
});
