import { describe, expect, test } from "vitest";
import type { SceneNode } from "../types";
import { effectiveScale, localDelta } from "./editing";

const n = (id: string, parentId: string | null, x = 0, y = 0, scale = 1): SceneNode =>
  ({ id, parentId, rungId: "r", x, y, scale });

describe("effectiveScale", () => {
  test("effectiveScale multiplies camera scale by the node's cumulative scale", () => {
    expect(effectiveScale(0.5, [n("a", null, 0, 0, 4)], "a")).toBe(2);
  });

  test("effectiveScale is the camera scale at the root", () => {
    expect(effectiveScale(0.5, [], null)).toBe(0.5);
  });

  test("effectiveScale falls back to the camera scale for an unknown node", () => {
    expect(effectiveScale(0.5, [], "ghost")).toBe(0.5);
  });

  test("effectiveScale accumulates down a chain of nodes", () => {
    const nodes = [n("w", null, 0, 0, 150), n("i", "w", 0, 0, 1 / 5)];
    expect(effectiveScale(0.01, nodes, "i")).toBeCloseTo(0.3);
  });
});

describe("localDelta", () => {
  test("localDelta converts a world drag delta into node-local units", () => {
    expect(localDelta({ x: 20, y: 10 }, { ox: 0, oy: 0, s: 2 })).toEqual({ x: 10, y: 5 });
  });

  test("localDelta ignores the node's offset — a delta is a difference, not a point", () => {
    expect(localDelta({ x: 20, y: 10 }, { ox: 300, oy: -40, s: 2 })).toEqual({ x: 10, y: 5 });
  });

  test("localDelta passes a delta through at zero scale rather than producing Infinity", () => {
    expect(localDelta({ x: 20, y: 10 }, { ox: 0, oy: 0, s: 0 })).toEqual({ x: 20, y: 10 });
  });
});
