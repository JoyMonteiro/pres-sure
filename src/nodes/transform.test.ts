import { describe, expect, test } from "vitest";
import { makeElement } from "../store/factory";
import type { SceneNode } from "../types";
import { resolveTransform, worldRect, worldToLocal } from "./transform";

const IDENT = { ox: 0, oy: 0, s: 1 };
const n = (id: string, parentId: string | null, x: number, y: number, scale: number): SceneNode =>
  ({ id, parentId, rungId: "r", x, y, scale });
const el = () => makeElement("text", { content: "x" });

describe("resolveTransform", () => {
  test("null nodeId resolves to identity", () => {
    expect(resolveTransform([], null)).toEqual(IDENT);
  });

  test("a root-parented node is its own offset and scale", () => {
    expect(resolveTransform([n("a", null, 10, 20, 2)], "a")).toEqual({ ox: 10, oy: 20, s: 2 });
  });

  test("a nested node composes parent offset with parent scale", () => {
    // child offset is in the parent's units, so it is scaled by the parent's scale
    const nodes = [n("a", null, 10, 20, 2), n("b", "a", 5, 5, 3)];
    expect(resolveTransform(nodes, "b")).toEqual({ ox: 20, oy: 30, s: 6 });
  });

  test("a missing nodeId resolves to identity rather than throwing", () => {
    expect(resolveTransform([n("a", null, 10, 20, 2)], "ghost")).toEqual(IDENT);
  });

  test("a cycle terminates and resolves to identity", () => {
    const nodes = [n("a", "b", 1, 1, 2), n("b", "a", 1, 1, 2)];
    expect(resolveTransform(nodes, "a")).toEqual(IDENT);
  });

  test("a deep chain stays finite at ITC depth", () => {
    // world 150, then /5, /25, /5 — the ITC ladder
    const nodes = [
      n("w", null, 0, 0, 150), n("i", "w", 0, 0, 1 / 5),
      n("s", "i", 0, 0, 1 / 25), n("k", "s", 0, 0, 1 / 5),
    ];
    const t = resolveTransform(nodes, "k");
    expect(t.s).toBeCloseTo(150 / 625, 12);
    expect(Number.isFinite(t.ox)).toBe(true);
  });

  test("a zero scale does not produce NaN downstream", () => {
    const t = resolveTransform([n("a", null, 5, 5, 0)], "a");
    expect(t.s).toBe(0);
    const r = worldRect({ ...el(), nodeId: "a", x: 1, y: 1, w: 2, h: 2 }, [n("a", null, 5, 5, 0)]);
    expect([r.x, r.y, r.w, r.h].every(Number.isFinite)).toBe(true);
  });
});

describe("worldRect / worldToLocal", () => {
  test("worldRect places and scales an element by its node", () => {
    const nodes = [n("a", null, 100, 100, 2)];
    const r = worldRect({ ...el(), nodeId: "a", x: 10, y: 5, w: 20, h: 8 }, nodes);
    expect(r).toEqual({ x: 120, y: 110, w: 40, h: 16 });
  });

  test("worldToLocal inverts a transform", () => {
    const t = { ox: 100, oy: 100, s: 2 };
    expect(worldToLocal({ x: 120, y: 110 }, t)).toEqual({ x: 10, y: 5 });
  });
});
