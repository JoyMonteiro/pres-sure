// Guards the hand-authored manual-test decks in fixtures/ — they are imported through the
// UI, so nothing else would catch an enterAt pointing at a frame that no longer exists.
// Regenerate them with `node scripts/make-test-deck.mjs`.
import { describe, expect, it } from "vitest";
import { flattenFrames, holdGroups, isHold, resolveFrameRect } from "./holds";
import { visibilityAt } from "./visibility";
import type { Presentation } from "../types";
// Imported rather than read from disk: no @types/node, and a malformed deck fails the
// build instead of only the test run.
import demoJson from "../../fixtures/hold-frames-demo.pressure.json";
import edgeJson from "../../fixtures/hold-frames-edge.pressure.json";

const load = (j: unknown): Presentation => j as Presentation;

describe("hold-frames-demo deck", () => {
  const p = load(demoJson);
  const indexOf = (id: string) => p.frames.findIndex((f) => f.id === id);
  const visible = (elId: string, i: number) =>
    visibilityAt(p.elements.find((e) => e.id === elId)!, p.frames, i).visible;

  it("is the 4 shots / 12 steps the walkthrough describes", () => {
    expect(holdGroups(p.frames).length).toBe(4);
    expect(p.frames.length).toBe(12);
  });

  it("has no dangling enterAt or exitAt", () => {
    const ids = new Set(p.frames.map((f) => f.id));
    for (const el of p.elements) {
      if (el.lifecycle.enterAt) expect(ids.has(el.lifecycle.enterAt), el.id).toBe(true);
      if (el.lifecycle.exitAt) expect(ids.has(el.lifecycle.exitAt), el.id).toBe(true);
    }
  });

  it("resolves every hold to its own group's shot rect", () => {
    for (const g of holdGroups(p.frames)) {
      const shotRect = resolveFrameRect(p.frames, g.startIndex);
      g.holds.forEach((_, k) => {
        expect(resolveFrameRect(p.frames, g.startIndex + 1 + k)).toEqual(shotRect);
      });
    }
  });

  it("carries the rotated shot's 12 degrees into its hold", () => {
    expect(resolveFrameRect(p.frames, indexOf("fr_d_h1"))!.rotation).toBe(12);
  });

  it("reveals one bullet per step, none of them early", () => {
    const bullets = ["el_a_1", "el_a_2", "el_a_3", "el_a_4"];
    bullets.forEach((elId, n) => {
      const enter = indexOf("fr_a") + n;
      if (n > 0) expect(visible(elId, enter - 1), `${elId} leaked early`).toBe(false);
      expect(visible(elId, enter), `${elId} missing on its step`).toBe(true);
      expect(visible(elId, p.frames.length - 1), `${elId} should persist`).toBe(true);
    });
  });

  it("keeps the leaving line through its exit hold and drops it after", () => {
    expect(visible("el_c_leaves", indexOf("fr_c"))).toBe(true);
    expect(visible("el_c_leaves", indexOf("fr_c_h1"))).toBe(true);
    expect(visible("el_c_leaves", indexOf("fr_c_h2"))).toBe(false);
  });

  it("exports to frames the runtime can read — real rects, no kind, same order", () => {
    const flat = flattenFrames(p.frames);
    expect(flat.map((f) => f.id)).toEqual(p.frames.map((f) => f.id));
    expect(flat.every((f) => f.kind === undefined)).toBe(true);
    expect(flat.every((f) => f.w > 1 && f.h > 1)).toBe(true);
  });
});

describe("hold-frames-edge deck", () => {
  const p = load(edgeJson);

  it("opens on a leading hold that falls back to the only shot", () => {
    expect(isHold(p.frames[0])).toBe(true);
    expect(resolveFrameRect(p.frames, 0)).toEqual(resolveFrameRect(p.frames, 1));
  });

  it("gives that leading hold its own group instead of dropping it", () => {
    const groups = holdGroups(p.frames);
    expect(groups.flatMap((g) => [g.shot.id, ...g.holds.map((h) => h.id)])).toEqual(
      p.frames.map((f) => f.id)
    );
  });
});
