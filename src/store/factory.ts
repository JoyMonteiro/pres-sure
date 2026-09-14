// Factories + id generation for model objects (§2.3).
import type {
  Element,
  ElementType,
  Frame,
  Presentation,
  TextStyle,
} from "../types";

export const uid = (prefix = "id"): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 48,
  fontWeight: 600,
  color: "#1a1a1a",
  align: "left",
};

export function makeElement(
  type: ElementType,
  partial: Partial<Element> & { content: string }
): Element {
  return {
    id: uid("el"),
    type,
    x: 0,
    y: 0,
    w: type === "text" ? 600 : 400,
    h: type === "text" ? 160 : 300,
    rotation: 0,
    z: 0,
    textStyle: type === "text" ? { ...DEFAULT_TEXT_STYLE } : undefined,
    lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
    ...partial,
  };
}

export function makeFrame(partial: Partial<Frame> & Pick<Frame, "x" | "y" | "w" | "h">): Frame {
  return {
    id: uid("fr"),
    title: "Frame",
    rotation: 0,
    duration: "auto",
    easing: "smooth",
    notes: "",
    ...partial,
  };
}

/**
 * A reveal step. Geometry is a placeholder — `resolveFrameRect` supplies the real rect —
 * but w/h stay non-zero so nothing that divides by them can produce Infinity.
 */
export function makeHold(partial: Partial<Frame> = {}): Frame {
  return {
    ...makeFrame({ x: 0, y: 0, w: 1, h: 1, title: "Step", ...partial }),
    kind: "hold",
    easing: "cut",
    duration: 0,
  };
}


export function makePresentation(title = "Untitled presentation"): Presentation {
  const now = Date.now();
  return {
    id: uid("pres"),
    title,
    createdAt: now,
    updatedAt: now,
    world: { backgroundColor: "#f4f4f5" },
    elements: [],
    frames: [],
    settings: { defaultEasing: "smooth", defaultDuration: "auto" },
  };
}
