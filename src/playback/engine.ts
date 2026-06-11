// Camera animation engine: Motion drives a scalar 0->1, mapped through the van Wijk
// path (§2.1.2). Motion never sees the raw transform, so it can't linearize the zoom.
import { animate } from "motion";
import type { Camera, Size } from "../camera/camera";
import { boundingBox } from "../camera/camera";
import { timingFor } from "../camera/easing";
import { autoDurationMs, zoomPanPath } from "../camera/vanwijk";
import type { Element, EasingPreset } from "../types";

export interface CameraAnim {
  stop: () => void;
  finished: Promise<void>;
}

export function animateCamera(
  from: Camera,
  to: Camera,
  viewport: Size,
  easing: EasingPreset,
  durationSetting: number | "auto",
  onUpdate: (c: Camera) => void,
  reducedMotion = false
): CameraAnim {
  const path = zoomPanPath(from, to, viewport);
  const durationMs = durationSetting === "auto" ? autoDurationMs(path) : durationSetting;
  const timing = timingFor(easing, durationMs, reducedMotion);

  if (timing.cut) {
    onUpdate(to);
    return { stop: () => {}, finished: Promise.resolve() };
  }

  let resolveFn: () => void = () => {};
  const finished = new Promise<void>((res) => (resolveFn = res));

  const controls = animate(0, 1, {
    ...timing.options,
    onUpdate: (t: number) => onUpdate(path.at(t)),
    onComplete: () => {
      onUpdate(to); // guarantee exact landing
      resolveFn();
    },
  });

  return {
    stop: () => {
      controls.stop();
      resolveFn();
    },
    finished,
  };
}

/** World bounds covering all elements, for the zoom-to-overview beat (§4.6). */
export function worldBounds(elements: Element[]): { x: number; y: number; w: number; h: number } {
  const box = boundingBox(elements);
  if (!box || box.w === 0 || box.h === 0) {
    return { x: -640, y: -360, w: 1280, h: 720 };
  }
  const padX = box.w * 0.1;
  const padY = box.h * 0.1;
  return { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 };
}
