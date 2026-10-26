import type { Frame, Presentation } from "../types";
import { visibilityAt } from "../playback/visibility";
import { StaticElement } from "./ElementView";
import { buildLayers } from "../nodes/layers";
import { NodeLayer } from "./NodeLayer";

const TW = 150;
const TH = 78;

/** Live CSS-clone thumbnail (§4.3) — a scaled-down view of the world over a frame's rect. */
export function Thumbnail({ presentation, frame, index }: { presentation: Presentation; frame: Frame; index: number }) {
  const scale = Math.min(TW / frame.w, TH / frame.h);
  const contentW = frame.w * scale;
  const contentH = frame.h * scale;
  const offsetX = (TW - contentW) / 2 - frame.x * scale;
  const offsetY = (TH - contentH) / 2 - frame.y * scale;
  const root = buildLayers(presentation.elements, presentation.nodes ?? []);

  return (
    <div className="frame-thumb" style={{ background: presentation.world.backgroundColor }}>
      <div
        className="thumb-world"
        style={{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale}) rotate(${-frame.rotation}deg)` }}
      >
        <NodeLayer
          layer={root}
          render={(el) =>
            visibilityAt(el, presentation.frames, index).visible ? <StaticElement key={el.id} el={el} /> : null
          }
        />
      </div>
    </div>
  );
}
