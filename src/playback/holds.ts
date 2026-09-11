// Hold frames — reveal steps that borrow the preceding shot's camera (spec D2/D3 in
// docs/superpowers/specs/2026-08-08-hold-frames-design.md).
//
// Pure and index-based, exactly like visibility.ts and stagger.ts: a hold is still an
// ordinary frame index, which is why lifecycle/visibility/stagger need no changes at all.
// Must not import store/factory.ts — id generation is impure and would break these tests.
import type { Rect } from "../camera/camera";
import type { Frame } from "../types";

export interface HoldGroup {
  shot: Frame;
  holds: Frame[];
  /** Flat index of `shot` in the frames array. */
  startIndex: number;
}

/** Absent `kind` means "shot", so old saves read correctly. */
export const isHold = (f: Frame): boolean => f.kind === "hold";

const rectOf = (f: Frame): Rect => ({ x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation });

/**
 * Effective camera rect at index `i`. A hold resolves to the nearest preceding shot; a
 * leading hold (which the reorder rules prevent) falls back to the first shot in the list.
 */
export function resolveFrameRect(frames: Frame[], i: number): Rect | null {
  const f = frames[i];
  if (!f) return null;
  if (!isHold(f)) return rectOf(f);
  for (let j = i - 1; j >= 0; j--) {
    if (!isHold(frames[j])) return rectOf(frames[j]);
  }
  return rectOf(frames.find((x) => !isHold(x)) ?? f);
}

/**
 * Shots with their trailing holds, for timeline rendering. A leading hold becomes its own
 * group rather than being dropped — a frame the timeline never draws would still consume a
 * click during playback.
 */
export function holdGroups(frames: Frame[]): HoldGroup[] {
  const groups: HoldGroup[] = [];
  frames.forEach((f, i) => {
    if (!isHold(f) || groups.length === 0) groups.push({ shot: f, holds: [], startIndex: i });
    else groups[groups.length - 1].holds.push(f);
  });
  return groups;
}
