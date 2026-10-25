// Queries over the flat scene-node array: the tree it describes, and the rungs it leaves
// empty (§2.3, scale ladder).
import type { Presentation, Rung, SceneNode } from "../types";
import { nodeChain } from "./transform";

/**
 * The nodes from the root down to `nodeId`, inclusive. Empty for the root (a nullish id),
 * for an unknown id, and for parent links that form a cycle — `nodeChain` is the single
 * cycle guard in `src/nodes/`, and callers of this function want a list to walk, not a
 * broken-tree signal.
 */
export function ancestorChain(
  nodes: SceneNode[],
  nodeId: string | null | undefined
): SceneNode[] {
  return nodeChain(nodes, nodeId) ?? [];
}

/**
 * The direct children of a node; `null` asks for the nodes parented straight to the world.
 * A self-parented node is excluded: `parentId === id` is reachable from a buggy reparent or
 * hand-edited JSON, and returning it as its own child would make any recursive walk over
 * this function — the nesting of render layers, for one — fail to terminate.
 */
export function childrenOf(nodes: SceneNode[], nodeId: string | null): SceneNode[] {
  return nodes.filter((node) => node.parentId === nodeId && node.id !== nodeId);
}

/**
 * Every node beneath `nodeId`, at any depth, excluding `nodeId` itself. A visited set
 * bounds the walk, so a cycle below the node terminates instead of hanging the editor.
 */
export function descendantIds(nodes: SceneNode[], nodeId: string): string[] {
  const found = new Set<string>();
  const queue = childrenOf(nodes, nodeId).map((child) => child.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (id === nodeId || found.has(id)) continue;
    found.add(id);
    for (const child of childrenOf(nodes, id)) queue.push(child.id);
  }
  return [...found];
}

/**
 * Rungs the author named but never built at: a rung with no node, or whose every node
 * holds no element and no frame. This is the five-named/four-built divergence the design
 * found, surfaced as a note rather than as an error — naming a scale ahead of filling it
 * is a normal way to work.
 */
export function unusedRungs(pres: Presentation): Rung[] {
  const rungs = pres.rungs ?? [];
  const nodes = pres.nodes ?? [];
  const occupied = new Set<string>();
  for (const el of pres.elements) if (el.nodeId) occupied.add(el.nodeId);
  for (const frame of pres.frames) if (frame.nodeId) occupied.add(frame.nodeId);
  return rungs.filter((rung) => {
    const atRung = nodes.filter((node) => node.rungId === rung.id);
    return !atRung.some((node) => occupied.has(node.id));
  });
}
