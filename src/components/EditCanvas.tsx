import { useEffect, useRef } from "react";
import { useStore } from "../store/store";
import { cameraToTransform, screenToWorld } from "../camera/camera";
import { EditableElement } from "./ElementView";

const MIN_SCALE = 0.02;
const MAX_SCALE = 40;

export function EditCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);

  const elements = useStore((s) => s.presentation.elements);
  const bg = useStore((s) => s.presentation.world.backgroundColor);
  const cam = useStore((s) => s.editorCamera);
  const viewport = useStore((s) => s.viewport);
  const guides = useStore((s) => s.guides);
  const selectedIds = useStore((s) => s.selectedIds);
  const setCam = useStore((s) => s.setEditorCamera);
  const setViewport = useStore((s) => s.setViewport);
  const select = useStore((s) => s.select);

  // Track viewport size for fit math.
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [setViewport]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * factor));
    const w = screenToWorld(sx, sy, cam, viewport);
    const k = cam.scale / newScale;
    setCam({
      cx: w.x - (w.x - cam.cx) * k,
      cy: w.y - (w.y - cam.cy) * k,
      scale: newScale,
      rotation: cam.rotation,
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target === ref.current || (e.target as HTMLElement).classList.contains("world")) {
      select([]);
      panning.current = { x: e.clientX, y: e.clientY };
      ref.current!.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning.current) return;
    const rect = ref.current!.getBoundingClientRect();
    const prev = screenToWorld(panning.current.x - rect.left, panning.current.y - rect.top, cam, viewport);
    const cur = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, cam, viewport);
    setCam({ ...cam, cx: cam.cx + (prev.x - cur.x), cy: cam.cy + (prev.y - cur.y) });
    panning.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    panning.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
  };

  const sorted = [...elements].sort((a, b) => a.z - b.z);

  return (
    <div
      ref={ref}
      className={`viewport${panning.current ? " panning" : ""}`}
      style={{ background: bg }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="world" style={{ transform: cameraToTransform(cam, viewport) }}>
        {sorted.map((el) => (
          <EditableElement
            key={el.id}
            el={el}
            scale={cam.scale}
            selected={selectedIds.includes(el.id)}
            // Only meaningful for a multi-selection — one selected element needs no number.
            selectionIndex={selectedIds.length > 1 ? selectedIds.indexOf(el.id) + 1 : 0}
          />
        ))}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div
              key={i}
              className="smart-guide"
              style={{ left: g.pos, top: -1e5, width: 1 / cam.scale, height: 2e5 }}
            />
          ) : (
            <div
              key={i}
              className="smart-guide"
              style={{ top: g.pos, left: -1e5, height: 1 / cam.scale, width: 2e5 }}
            />
          )
        )}
      </div>
    </div>
  );
}
