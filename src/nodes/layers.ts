// Grouping elements into the nested render layers the node tree describes (§2.3, scale
// ladder). A node's scale becomes a CSS transform on its layer, so a text element keeps
// the font size it was authored with however deep it sits.
import type { Element, SceneNode } from "../types";
import { childrenOf } from "./tree";

export interface Layer {
  /** The node this layer renders, or null for the root layer — the world itself. */
  node: SceneNode | null;
  elements: Element[];
  children: Layer[];
}

/**
 * The root layer of the tree `nodes` describes, with every element in the layer its
 * `nodeId` names. An element whose `nodeId` is unknown, or names a node the walk never
 * reaches (a cycle), falls back to the root: a typo or a stale id must leave the element
 * visible at full size rather than blank the canvas.
 */
export function buildLayers(elements: Element[], nodes: SceneNode[]): Layer {
  const byNode = new Map<string, Element[]>();
  const rootElements: Element[] = [];
  const sorted = [...elements].sort((a, b) => a.z - b.z);

  const placed = new Set<string>();
  const visited = new Set<string>();
  const build = (node: SceneNode | null): Layer => {
    const own: Element[] = [];
    if (node) {
      placed.add(node.id);
      byNode.set(node.id, own);
    }
    const children: Layer[] = [];
    for (const child of childrenOf(nodes, node?.id ?? null)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      children.push(build(child));
    }
    return { node, elements: node ? own : rootElements, children };
  };
  const root = build(null);

  for (const el of sorted) {
    const bucket = el.nodeId && placed.has(el.nodeId) ? byNode.get(el.nodeId)! : rootElements;
    bucket.push(el);
  }
  return root;
}

/**
 * The CSS transform for a layer: translate first, then scale, so the node's offset is read
 * in its parent's units and its own contents are scaled about its origin.
 */
export function layerTransform(node: SceneNode): string {
  return `translate(${node.x}px, ${node.y}px) scale(${node.scale})`;
}
