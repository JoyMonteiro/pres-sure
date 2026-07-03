import { describe, expect, it } from "vitest";
import { visibilityAt } from "./visibility";
import type { Element, Frame } from "../types";

const frame = (id: string): Frame => ({
  id,
  title: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  duration: "auto",
  easing: "smooth",
  notes: "",
});

const el = (lifecycle: Partial<Element["lifecycle"]>): Element => ({
  id: "e1",
  type: "text",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z: 0,
  content: "",
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist", ...lifecycle },
});

const frames = [frame("f1"), frame("f2"), frame("f3")];

describe("visibilityAt", () => {
  it("element with no enterAt is visible from the start and never 'entering'", () => {
    expect(visibilityAt(el({}), frames, 0)).toEqual({ visible: true, entering: false, leaving: false });
  });

  it("element entering at f2 is hidden at f1, entering at f2, plain-visible at f3", () => {
    const e = el({ enterAt: "f2", enterEffect: "fade" });
    expect(visibilityAt(e, frames, 0).visible).toBe(false);
    expect(visibilityAt(e, frames, 1)).toEqual({ visible: true, entering: true, leaving: false });
    expect(visibilityAt(e, frames, 2)).toEqual({ visible: true, entering: false, leaving: false });
  });

  it("leave element is 'leaving' on its exit frame and hidden past it", () => {
    const e = el({ enterAt: "f1", onExit: "leave", exitAt: "f2", exitEffect: "fade" });
    expect(visibilityAt(e, frames, 1).leaving).toBe(true);
    expect(visibilityAt(e, frames, 2).visible).toBe(false);
  });
});
