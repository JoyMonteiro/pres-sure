import { AnimatePresence } from "motion/react";
import type { Camera, Size } from "../camera/camera";
import { cameraToTransform } from "../camera/camera";
import type { Element, Presentation } from "../types";
import { visibilityAt } from "../playback/visibility";
import { enterOrder } from "../playback/stagger";
import { PlaybackElement } from "./ElementView";
import { buildLayers } from "../nodes/layers";
import { NodeLayer } from "./NodeLayer";

/** Read-only render of the world at a given camera — used by player, presenter, thumbs. */
export function Stage({
  presentation,
  camera,
  viewport,
  currentIndex,
  animate = true,
  moving = false,
}: {
  presentation: Presentation;
  camera: Camera;
  viewport: Size;
  currentIndex: number;
  animate?: boolean;
  /** Camera in flight: hint will-change for smooth motion, and drop it at rest so zooms re-rasterise sharply. */
  moving?: boolean;
}) {
  const els = [...presentation.elements].sort((a, b) => a.z - b.z);
  const order = enterOrder(els, presentation.frames, currentIndex);
  const root = buildLayers(presentation.elements, presentation.nodes ?? []);
  // Visibility and stagger stay keyed on the element; the layer only carries the node's
  // transform, so a node's scale never reaches an element's font size.
  const renderElement = (el: Element) => {
    const v = visibilityAt(el, presentation.frames, currentIndex);
    if (!v.visible) return null;
    if (!animate) return <PlaybackElement key={el.id} el={el} entering={false} leaving={false} />;
    return (
      <PlaybackElement
        key={el.id}
        el={el}
        entering={v.entering}
        leaving={v.leaving}
        staggerIndex={order.get(el.id) ?? 0}
      />
    );
  };
  return (
    <div
      className="viewport"
      style={{ width: viewport.width, height: viewport.height, background: presentation.world.backgroundColor }}
    >
      <div className="world" style={{ transform: cameraToTransform(camera, viewport), willChange: moving ? "transform" : "auto" }}>
        <NodeLayer
          layer={root}
          render={renderElement}
          wrap={animate ? (children) => <AnimatePresence>{children}</AnimatePresence> : undefined}
        />
      </div>
    </div>
  );
}
