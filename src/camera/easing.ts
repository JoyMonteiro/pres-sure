// Named transition "feels" -> Motion animation options (§4.4).
// Springs ignore duration (the UI hides duration for spring presets).
import type { EasingPreset } from "../types";

export interface MotionTiming {
  /** Whether this preset is governed by a spring (duration becomes advisory). */
  spring: boolean;
  /** Options object passed to Motion's animate() for the scalar 0->1 driver. */
  options: Record<string, unknown>;
  /** Instant cut (no animation). */
  cut: boolean;
}

export const EASING_PRESETS: { value: EasingPreset; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "snappy", label: "Snappy" },
  { value: "slowDrift", label: "Slow drift" },
  { value: "cut", label: "Cut" },
];

/**
 * @param durationMs resolved duration in ms (already distance-aware if "auto").
 * @param reducedMotion when true, every preset collapses to an instant cut (§4.6).
 */
export function timingFor(
  preset: EasingPreset,
  durationMs: number,
  reducedMotion = false
): MotionTiming {
  if (reducedMotion || preset === "cut") {
    return { spring: false, cut: true, options: { duration: 0 } };
  }
  switch (preset) {
    case "snappy":
      return {
        spring: true,
        cut: false,
        options: { type: "spring", stiffness: 320, damping: 30, restDelta: 0.0005 },
      };
    case "slowDrift":
      return {
        spring: false,
        cut: false,
        options: { duration: (durationMs * 1.6) / 1000, ease: [0.33, 0, 0.2, 1] },
      };
    case "smooth":
    default:
      return {
        spring: false,
        cut: false,
        options: { duration: durationMs / 1000, ease: [0.4, 0, 0.2, 1] },
      };
  }
}
