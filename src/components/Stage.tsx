import { AnimatePresence } from "motion/react";
import type { Camera, Size } from "../camera/camera";
import { cameraToTransform } from "../camera/camera";
import type { Presentation } from "../types";
import { visibilityAt } from "../playback/visibility";
import { PlaybackElement } from "./ElementView";

/** Read-only render of the world at a given camera — used by player, presenter, thumbs. */
export function Stage({
  presentation,
  camera,
  viewport,
  currentIndex,
  animate = true,
}: {
  presentation: Presentation;
  camera: Camera;
  viewport: Size;
  currentIndex: number;
  animate?: boolean;
}) {
  const els = [...presentation.elements].sort((a, b) => a.z - b.z);
  return (
    <div
      className="viewport"
      style={{ width: viewport.width, height: viewport.height, background: presentation.world.backgroundColor }}
    >
      <div className="world" style={{ transform: cameraToTransform(camera, viewport) }}>
        {animate ? (
          <AnimatePresence>
            {els.map((el) => {
              const v = visibilityAt(el, presentation.frames, currentIndex);
              if (!v.visible) return null;
              return <PlaybackElement key={el.id} el={el} entering={v.entering} leaving={v.leaving} />;
            })}
          </AnimatePresence>
        ) : (
          els.map((el) => {
            const v = visibilityAt(el, presentation.frames, currentIndex);
            if (!v.visible) return null;
            return <PlaybackElement key={el.id} el={el} entering={false} leaving={false} />;
          })
        )}
      </div>
    </div>
  );
}
