import { describe, expect, it } from "vitest";
import { enterOrder, STAGGER_STEP_S } from "./stagger";
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

const el = (id: string, z: number, enterAt: string | null): Element => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z,
  content: "",
  lifecycle: { enterAt, enterEffect: "fade", onExit: "persist" },
});

const frames = [frame("f1"), frame("f2")];

describe("enterOrder", () => {
  it("orders same-frame entrances back-to-front by z", () => {
    const els = [el("a", 5, "f2"), el("b", 1, "f2"), el("c", 3, "f2")];
    const order = enterOrder(els, frames, 1);
    expect(order.get("b")).toBe(0);
    expect(order.get("c")).toBe(1);
    expect(order.get("a")).toBe(2);
  });

  it("excludes elements not entering at this frame", () => {
    const els = [el("a", 0, "f2"), el("b", 1, null)];
    const order = enterOrder(els, frames, 1);
    expect(order.has("b")).toBe(false);
    expect(order.get("a")).toBe(0);
  });

  it("exposes a 60ms stagger step", () => {
    expect(STAGGER_STEP_S).toBe(0.06);
  });
});
