import { useCallback, useRef } from "react";
import type { Camera } from "../camera/camera";
import type { EasingPreset } from "../types";
import { animateCamera, type CameraAnim } from "./engine";
import { useStore } from "../store/store";

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate the editor camera to a target, cancelling any in-flight move. */
export function useCameraTo() {
  const anim = useRef<CameraAnim | null>(null);
  return useCallback((target: Camera, easing: EasingPreset, duration: number | "auto") => {
    anim.current?.stop();
    const { editorCamera, viewport, setEditorCamera } = useStore.getState();
    anim.current = animateCamera(
      editorCamera,
      target,
      viewport,
      easing,
      duration,
      setEditorCamera,
      prefersReducedMotion()
    );
    return anim.current.finished;
  }, []);
}
