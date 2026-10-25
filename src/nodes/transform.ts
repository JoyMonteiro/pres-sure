// Resolving scene-node transforms to world space (§2.3, scale ladder).
import type { Element, NodeTransform, SceneNode } from "../types";

export const IDENTITY_TRANSFORM: NodeTransform = { ox: 0, oy: 0, s: 1 };

/**
 * The chain of nodes from the root down to `nodeId`, or null if the id is unknown or
 * the parent links form a cycle. The visited set is the cycle guard: a well-formed
 * chain visits each node at most once, so a repeat means the links loop.
 */
export function ancestorChain(
  nodes: SceneNode[],
  nodeId: string | null | undefined
): SceneNode[] | null {
  if (!nodeId) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: SceneNode[] = [];
  const visited = new Set<string>();
  let id: string | null | undefined = nodeId;
  while (id) {
    if (visited.has(id)) return null;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return null;
    chain.push(node);
    id = node.parentId;
  }
  return chain.reverse();
}

/**
 * Compose a node's placement with every ancestor's, root-first: a child's offset is in
 * its parent's units, so it is scaled by the parent's accumulated scale. A nullish id,
 * an unknown id, or a cycle resolves to identity so callers never have to branch.
 */
export function resolveTransform(
  nodes: SceneNode[],
  nodeId: string | null | undefined
): NodeTransform {
  const chain = ancestorChain(nodes, nodeId);
  if (!chain) return { ...IDENTITY_TRANSFORM };
  let { ox, oy, s } = IDENTITY_TRANSFORM;
  for (const node of chain) {
    ox += node.x * s;
    oy += node.y * s;
    s *= node.scale;
  }
  return { ox, oy, s };
}

/** An element's local rect placed into world space by its node's transform. */
export function worldRect(
  el: Element,
  nodes: SceneNode[]
): { x: number; y: number; w: number; h: number } {
  const { ox, oy, s } = resolveTransform(nodes, el.nodeId);
  return { x: ox + el.x * s, y: oy + el.y * s, w: el.w * s, h: el.h * s };
}

/** The inverse of `worldRect`'s mapping for a point. A zero scale is not invertible. */
export function worldToLocal(
  pt: { x: number; y: number },
  t: NodeTransform
): { x: number; y: number } {
  if (t.s === 0) return { x: pt.x, y: pt.y };
  return { x: (pt.x - t.ox) / t.s, y: (pt.y - t.oy) / t.s };
}
