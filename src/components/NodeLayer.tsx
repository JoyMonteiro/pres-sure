import type { ReactNode } from "react";
import type { Element } from "../types";
import type { Layer } from "../nodes/layers";
import { layerTransform } from "../nodes/layers";

/**
 * One node's content inside a transformed container, with its child nodes nested inside it
 * (§2.3). The root layer has no node and so no wrapper transform — a deck with no nodes
 * renders exactly the markup it did before the ladder existed.
 */
export function NodeLayer({
  layer,
  render,
  wrap,
}: {
  layer: Layer;
  render: (el: Element) => ReactNode;
  /**
   * Wraps each layer's own elements. `AnimatePresence` only sees its direct children, so a
   * caller that animates exits passes one per layer rather than a single one at the root.
   */
  wrap?: (children: ReactNode) => ReactNode;
}) {
  const own = layer.elements.map((el) => render(el));
  const content = (
    <>
      {wrap ? wrap(own) : own}
      {layer.children.map((child) => (
        <NodeLayer key={child.node!.id} layer={child} render={render} wrap={wrap} />
      ))}
    </>
  );
  if (!layer.node) return content;
  return (
    <div
      className="node-layer"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: layerTransform(layer.node),
        transformOrigin: "0 0",
      }}
    >
      {content}
    </div>
  );
}
