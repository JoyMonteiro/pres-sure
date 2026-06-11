import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera, Size } from "../camera/camera";
import { frameToCamera } from "../camera/camera";
import { animateCamera } from "../playback/engine";
import { worldBounds } from "../playback/engine";
import { prefersReducedMotion } from "../playback/useCameraTo";
import { openChannel } from "../playback/sync";
import { useStore } from "../store/store";
import { Stage } from "./Stage";

function useWindowSize(): Size {
  const [s, set] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const on = () => set({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

export function Player() {
  const presentation = useStore((s) => s.presentation);
  const setMode = useStore((s) => s.setMode);
  const frames = presentation.frames;
  const viewport = useWindowSize();

  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const camRef = useRef<Camera>(frames[0] ? frameToCamera(frames[0], viewport) : { cx: 0, cy: 0, scale: 1, rotation: 0 });
  const [cam, setCam] = useState<Camera>(camRef.current);
  const animRef = useRef<{ stop: () => void } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    channel.current = openChannel();
    return () => channel.current?.close();
  }, []);

  const apply = useCallback((c: Camera) => {
    camRef.current = c;
    setCam(c);
  }, []);

  const broadcast = useCallback(
    (i: number, ov: boolean) => {
      channel.current?.postMessage({ type: "state", index: i, overview: ov, presentationId: presentation.id });
    },
    [presentation.id]
  );

  const moveTo = useCallback(
    (target: Camera, easing: typeof frames[number]["easing"], duration: number | "auto") => {
      animRef.current?.stop();
      animRef.current = animateCamera(camRef.current, target, viewport, easing, duration, apply, prefersReducedMotion());
    },
    [viewport, apply]
  );

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(frames.length - 1, i));
      const f = frames[clamped];
      if (!f) return;
      setOverview(false);
      setIndex(clamped);
      broadcast(clamped, false);
      moveTo(frameToCamera(f, viewport), f.easing, f.duration);
    },
    [frames, viewport, moveTo, broadcast]
  );

  const toggleOverview = useCallback(() => {
    if (overview) {
      goTo(index);
    } else {
      setOverview(true);
      broadcast(index, true);
      const wb = worldBounds(presentation.elements);
      moveTo(frameToCamera({ ...wb, rotation: 0 }, viewport), "smooth", "auto");
    }
  }, [overview, index, goTo, broadcast, presentation.elements, viewport, moveTo]);

  // Initial landing.
  useEffect(() => {
    if (frames[0]) apply(frameToCamera(frames[0], viewport));
    broadcast(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          overview ? goTo(index) : goTo(index + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          overview ? goTo(index) : goTo(index - 1);
          break;
        case "Home":
          goTo(0);
          break;
        case "End":
          goTo(frames.length - 1);
          break;
        case "o":
        case "O":
          toggleOverview();
          break;
        case "Escape":
          setMode("edit");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, overview, frames.length, goTo, toggleOverview, setMode]);

  if (frames.length === 0) {
    return (
      <div className="player" style={{ display: "grid", placeItems: "center", color: "#fff" }}>
        <div style={{ textAlign: "center" }}>
          <p>No frames to present yet.</p>
          <button onClick={() => setMode("edit")}>Back to editor</button>
        </div>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="progress" style={{ width: `${((index + 1) / frames.length) * 100}%` }} />
      <Stage presentation={presentation} camera={cam} viewport={viewport} currentIndex={index} />
      <div className="player-hud">
        <button onClick={() => goTo(index - 1)}>‹ Prev</button>
        <button onClick={() => goTo(index + 1)}>Next ›</button>
        <button onClick={toggleOverview}>{overview ? "Resume" : "Overview (O)"}</button>
        <button onClick={() => setMode("edit")}>Exit (Esc)</button>
      </div>
    </div>
  );
}
