import { describe, expect, it } from "vitest";
import { holdGroups, isHold, resolveFrameRect } from "./holds";
import type { Frame } from "../types";

const shot = (id: string, x = 0, rotation = 0): Frame => ({
  id,
  title: id,
  x,
  y: 0,
  w: 100,
  h: 100,
  rotation,
  duration: "auto",
  easing: "smooth",
  notes: "",
});

const hold = (id: string): Frame => ({
  ...shot(id, 999),
  kind: "hold",
  easing: "cut",
  duration: 0,
});

describe("isHold", () => {
  it("treats a frame with no kind as a shot", () => {
    expect(isHold(shot("f1"))).toBe(false);
    expect(isHold(hold("h1"))).toBe(true);
  });
});

describe("resolveFrameRect", () => {
  it("returns a shot's own rect", () => {
    const frames = [shot("f1", 10)];
    expect(resolveFrameRect(frames, 0)).toEqual({ x: 10, y: 0, w: 100, h: 100, rotation: 0 });
  });

  it("resolves a hold to the preceding shot, ignoring the hold's own geometry", () => {
    const frames = [shot("f1", 10), hold("h1")];
    expect(resolveFrameRect(frames, 1)).toEqual({ x: 10, y: 0, w: 100, h: 100, rotation: 0 });
  });

  it("resolves consecutive holds to the same shot", () => {
    const frames = [shot("f1", 10), hold("h1"), hold("h2"), hold("h3")];
    expect(resolveFrameRect(frames, 3)).toEqual(resolveFrameRect(frames, 1));
  });

  it("carries the shot's rotation", () => {
    const frames = [shot("f1", 10, 45), hold("h1")];
    expect(resolveFrameRect(frames, 1)!.rotation).toBe(45);
  });

  it("resolves a shot after a build to itself, not to the earlier shot", () => {
    const frames = [shot("f1", 10), hold("h1"), shot("f2", 20)];
    expect(resolveFrameRect(frames, 2)!.x).toBe(20);
  });

  it("falls back to the first shot for a leading hold", () => {
    const frames = [hold("h1"), shot("f1", 10)];
    expect(resolveFrameRect(frames, 0)!.x).toBe(10);
  });

  it("returns null for an out-of-range index", () => {
    expect(resolveFrameRect([shot("f1")], 5)).toBeNull();
  });
});

describe("holdGroups", () => {
  it("attaches trailing holds to their shot", () => {
    const frames = [shot("f1"), hold("h1"), hold("h2"), shot("f2"), hold("h3")];
    const groups = holdGroups(frames);
    expect(groups.map((g) => g.shot.id)).toEqual(["f1", "f2"]);
    expect(groups[0].holds.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(groups[1].holds.map((h) => h.id)).toEqual(["h3"]);
  });

  it("reports the flat index of each shot", () => {
    const frames = [shot("f1"), hold("h1"), shot("f2")];
    expect(holdGroups(frames).map((g) => g.startIndex)).toEqual([0, 2]);
  });

  it("never drops a leading hold — it becomes its own group", () => {
    const frames = [hold("h1"), shot("f1")];
    const groups = holdGroups(frames);
    expect(groups.flatMap((g) => [g.shot.id, ...g.holds.map((h) => h.id)])).toEqual(["h1", "f1"]);
  });
});
