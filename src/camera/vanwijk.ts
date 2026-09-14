// Smooth and efficient zooming and panning — van Wijk & Nuij (IEEE InfoVis 2003).
//
// This is the heart of the "cinematic" camera feel (§2.1.2). Instead of linearly
// interpolating the raw transform between two frames — which streaks sideways at huge
// apparent velocity when zoomed in — we follow an optimal path that zooms OUT to cover
// the distance, translates, then zooms back IN.
//
// We express each camera as (cx, cy, w) where w is the world-space width visible on
// screen (w = viewport.width / scale). The algorithm works on this "width" form, then
// we convert back to scale for rendering.

import type { Camera, Size } from "./camera";

export interface ZoomPanPath {
  /** Total path length S, in van Wijk's normalized units (used for distance-aware timing). */
  S: number;
  /** Sample the interpolated camera at normalized progress t in [0, 1]. */
  at: (t: number) => Camera;
}

const EPSILON = 1e-6;

/**
 * Build a smooth zoom/pan path between two cameras for a given viewport.
 * @param rho  curvature/zoom tradeoff. ~1.4 is van Wijk's perceptually-tuned default.
 */
export function zoomPanPath(
  from: Camera,
  to: Camera,
  viewport: Size,
  rho = 1.4
): ZoomPanPath {
  // Convert scale -> visible world width.
  const w0 = viewport.width / from.scale;
  const w1 = viewport.width / to.scale;

  const ux0 = from.cx;
  const uy0 = from.cy;
  const ux1 = to.cx;
  const uy1 = to.cy;

  const dx = ux1 - ux0;
  const dy = uy1 - uy0;
  const u1 = Math.hypot(dx, dy); // distance between the two centers in world units

  const rho2 = rho * rho;

  // Rotation interpolates linearly along the same parameter (shortest arc).
  const dRot = shortestAngleDelta(from.rotation, to.rotation);

  // Degenerate case: centers (almost) coincide -> pure zoom, interpolate w in log space.
  if (u1 < EPSILON) {
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return {
      S: S < EPSILON ? EPSILON : S,
      at: (t) => {
        const w = w0 * Math.pow(w1 / w0, t);
        return {
          cx: ux0,
          cy: uy0,
          scale: viewport.width / w,
          rotation: from.rotation + dRot * t,
        };
      },
    };
  }

  // General case — van Wijk eq. (9)–(11).
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
  const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
  const S = (r1 - r0) / rho;

  const coshR0 = Math.cosh(r0);

  return {
    S: Math.abs(S) < EPSILON ? EPSILON : Math.abs(S),
    at: (t) => {
      const r = r0 + rho * t * S; // arc-length position along the path
      // u in [0,1]: fractional progress of the camera center along the line A->B.
      const u = (w0 / (rho2 * u1)) * (coshR0 * Math.tanh(r) - Math.sinh(r0));
      // Visible world width along the path (zooms out then back in).
      const w = (w0 * coshR0) / Math.cosh(r);

      return {
        cx: ux0 + dx * u,
        cy: uy0 + dy * u,
        scale: viewport.width / w,
        rotation: from.rotation + dRot * t,
      };
    },
  };
}

/**
 * Distance-aware default duration (§2.1.2 / §4.4): longer journeys take longer, with
 * sane clamps. Returns milliseconds.
 */
export function autoDurationMs(path: ZoomPanPath): number {
  const base = 700; // ms for a typical short move
  const ms = base * (0.4 + path.S);
  return Math.max(350, Math.min(2600, Math.round(ms)));
}

function shortestAngleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
