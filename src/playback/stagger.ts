// Deterministic entrance ordering for elements that enter at the same frame (§ D2
// of docs/animation-enhancements-design.md). Ripples back-to-front by z, 60ms apart.
// Shared mental model with the export runtime (which re-implements it in plain JS).
import type { Element, Frame } from "../types";
import { visibilityAt } from "./visibility";

export const STAGGER_STEP_S = 0.06;

/** Element id -> 0-based entrance position among elements entering at this frame. */
export function enterOrder(
  elements: Element[],
  frames: Frame[],
  currentIndex: number
): Map<string, number> {
  const entering = elements
    .filter((e) => visibilityAt(e, frames, currentIndex).entering)
    .sort((a, b) => a.z - b.z);
  return new Map(entering.map((e, i) => [e.id, i]));
}
