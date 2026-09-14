// Element visibility as a pure function of frame index (§2.3 / §4.5).
// Shared mental model with the export runtime (which re-implements it in plain JS).
import type { Element, Frame } from "../types";

export interface VisState {
  visible: boolean;
  /** This element enters exactly at the current frame (play entrance effect). */
  entering: boolean;
  /** This element leaves exactly past the current frame (play exit effect). */
  leaving: boolean;
}

const indexOfFrame = (frames: Frame[], id: string | null | undefined): number => {
  if (!id) return -1;
  return frames.findIndex((f) => f.id === id);
};

/**
 * Determine an element's visibility at a given frame index. Deterministic and symmetric:
 * stepping backward re-hides/re-shows correctly because it depends only on currentIndex.
 */
export function visibilityAt(el: Element, frames: Frame[], currentIndex: number): VisState {
  const lc = el.lifecycle;
  // enterAt null => present from the start (enter index 0).
  const enterIdx = lc.enterAt ? indexOfFrame(frames, lc.enterAt) : 0;

  if (currentIndex < enterIdx) {
    return { visible: false, entering: false, leaving: false };
  }

  let leaveIdx = Infinity;
  if (lc.onExit === "leave") {
    const exitRef = lc.exitAt ?? lc.enterAt ?? frames[enterIdx]?.id;
    const i = indexOfFrame(frames, exitRef ?? null);
    leaveIdx = i >= 0 ? i : enterIdx;
  }

  if (currentIndex > leaveIdx) {
    return { visible: false, entering: false, leaving: false };
  }

  return {
    visible: true,
    entering: currentIndex === enterIdx && enterIdx >= 0 && !!lc.enterAt,
    leaving: currentIndex === leaveIdx && Number.isFinite(leaveIdx),
  };
}
