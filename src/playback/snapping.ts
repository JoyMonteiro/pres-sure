// Smart guides + snap-on-release (§4.1).
import type { Guide } from "../store/store";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Given a moving box and stationary boxes, find alignment guides within threshold and
 * the snapped top-left position. Compares left/center/right and top/middle/bottom.
 */
export function computeSnap(
  moving: Box,
  others: Box[],
  threshold: number
): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = [];
  let snapX = moving.x;
  let snapY = moving.y;
  let bestDx = threshold;
  let bestDy = threshold;

  const movXs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movYs = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  for (const o of others) {
    const oXs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oYs = [o.y, o.y + o.h / 2, o.y + o.h];

    movXs.forEach((mx, mi) => {
      oXs.forEach((ox) => {
        const d = Math.abs(mx - ox);
        if (d <= bestDx) {
          bestDx = d;
          snapX = moving.x + (ox - mx);
          // store guide line at the aligned x (account which edge for display position)
          guides.push({ axis: "x", pos: ox });
          void mi;
        }
      });
    });
    movYs.forEach((my) => {
      oYs.forEach((oy) => {
        const d = Math.abs(my - oy);
        if (d <= bestDy) {
          bestDy = d;
          snapY = moving.y + (oy - my);
          guides.push({ axis: "y", pos: oy });
        }
      });
    });
  }

  // Keep only guides matching the final snap to avoid clutter.
  const finalGuides: Guide[] = [];
  if (bestDx < threshold) {
    const matched = guides.filter((g) => g.axis === "x");
    if (matched.length) finalGuides.push(matched[matched.length - 1]);
  }
  if (bestDy < threshold) {
    const matched = guides.filter((g) => g.axis === "y");
    if (matched.length) finalGuides.push(matched[matched.length - 1]);
  }

  return { x: snapX, y: snapY, guides: finalGuides };
}
