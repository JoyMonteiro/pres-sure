// Camera primitives and the world-transform fit math (§2.1.1, §2.5).

import type { Frame } from "../types";

/** A camera state in world space: center point + zoom scale + rotation (degrees). */
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/**
 * Contain-fit (§2.1.1): the scale at which a rectangle of size (w,h) fits inside a
 * viewport without cropping. Letterboxing appears on the axis with the larger ratio.
 */
export function containScale(rectW: number, rectH: number, viewport: Size): number {
  if (rectW <= 0 || rectH <= 0) return 1;
  return Math.min(viewport.width / rectW, viewport.height / rectH);
}

/** Convert a frame's camera rectangle into a Camera (center + contain-fit scale). */
export function frameToCamera(frame: Rect, viewport: Size): Camera {
  return {
    cx: frame.x + frame.w / 2,
    cy: frame.y + frame.h / 2,
    scale: containScale(frame.w, frame.h, viewport),
    rotation: frame.rotation,
  };
}

/**
 * The CSS transform string for the world container given a camera and viewport.
 * Order (transform-origin: 0 0): translate to viewport center, rotate, scale,
 * translate camera center to origin (§2.5).
 */
export function cameraToTransform(cam: Camera, viewport: Size): string {
  const { width: VW, height: VH } = viewport;
  return [
    `translate(${VW / 2}px, ${VH / 2}px)`,
    `rotate(${-cam.rotation}deg)`,
    `scale(${cam.scale})`,
    `translate(${-cam.cx}px, ${-cam.cy}px)`,
  ].join(" ");
}

/**
 * Inverse mapping: a point in screen/viewport coordinates -> world coordinates,
 * given the current camera. Used for click-to-place and pointer-driven panning.
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  cam: Camera,
  viewport: Size
): { x: number; y: number } {
  const { width: VW, height: VH } = viewport;
  // Undo translate-to-center.
  let dx = screenX - VW / 2;
  let dy = screenY - VH / 2;
  // Undo rotation (rotate by +rotation since transform applied -rotation).
  const rad = (cam.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  // Undo scale, then re-add camera center.
  return {
    x: cam.cx + rx / cam.scale,
    y: cam.cy + ry / cam.scale,
  };
}

/** Build the camera rectangle for a frame from a Camera + viewport (for click-to-frame). */
export function cameraToFrameRect(cam: Camera, viewport: Size): Rect {
  const w = viewport.width / cam.scale;
  const h = viewport.height / cam.scale;
  return {
    x: cam.cx - w / 2,
    y: cam.cy - h / 2,
    w,
    h,
    rotation: cam.rotation,
  };
}

/** Axis-aligned bounding box that encloses a set of element rects (for frame-to-selection). */
export function boundingBox(
  rects: { x: number; y: number; w: number; h: number }[]
): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const frameRect = (f: Frame): Rect => ({
  x: f.x,
  y: f.y,
  w: f.w,
  h: f.h,
  rotation: f.rotation,
});
