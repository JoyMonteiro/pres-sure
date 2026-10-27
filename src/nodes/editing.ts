// Editing inside a scene node (§2.3, scale ladder). A node's scale reaches the DOM as a
// CSS transform, so an element's stored rect stays node-local — but every interaction
// measured in screen pixels (react-rnd's drag/resize scale, the snap tolerance, the raster
// blur hint) has to know how large one local unit actually is on screen.
import type { NodeTransform, SceneNode } from "../types";
import { resolveTransform } from "./transform";

/**
 * The on-screen scale of one unit inside `nodeId`: the camera's scale times the node's
 * cumulative scale. An unknown id or a cycle resolves to identity, so this is the plain
 * camera scale at the root and for any id that no longer names a node.
 *
 * A zero or non-finite cumulative scale falls back to the camera scale too. This value is
 * a divisor — react-rnd divides pointer deltas by it, and the snap tolerance is `6 / s` —
 * so a `scale: 0` node (or node JSON with no `scale` at all) would otherwise write
 * Infinity/NaN into the element's stored rect, which only undo can take back.
 */
export function effectiveScale(
  camScale: number,
  nodes: SceneNode[],
  nodeId: string | null | undefined
): number {
  const { s } = resolveTransform(nodes, nodeId);
  return Number.isFinite(s) && s !== 0 ? camScale * s : camScale;
}

/**
 * A world-space drag delta in node-local units. Only the scale divides out: a delta is a
 * difference between two points, so the node's offset cancels. A zero-scale node is not
 * invertible, so the delta passes through rather than becoming Infinity/NaN.
 */
export function localDelta(
  d: { x: number; y: number },
  t: NodeTransform
): { x: number; y: number } {
  if (t.s === 0) return { x: d.x, y: d.y };
  return { x: d.x / t.s, y: d.y / t.s };
}
