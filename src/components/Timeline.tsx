import { useRef, useState } from "react";
import { useStore } from "../store/store";
import { frameToCamera } from "../camera/camera";
import { useCameraTo } from "../playback/useCameraTo";
import { Thumbnail } from "./Thumbnail";

export function Timeline() {
  const frames = useStore((s) => s.presentation.frames);
  const presentation = useStore((s) => s.presentation);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const viewport = useStore((s) => s.viewport);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const captureFrame = useStore((s) => s.captureFrame);
  const frameToSelection = useStore((s) => s.frameToSelection);
  const duplicateFrame = useStore((s) => s.duplicateFrame);
  const removeFrame = useStore((s) => s.removeFrame);
  const reorderFrames = useStore((s) => s.reorderFrames);
  const updateFrame = useStore((s) => s.updateFrame);
  const selectedCount = useStore((s) => s.selectedIds.length);
  const cameraTo = useCameraTo();

  const dragIdx = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const goTo = (id: string) => {
    const f = frames.find((fr) => fr.id === id);
    if (!f) return;
    setCurrentFrame(id);
    cameraTo(frameToCamera(f, viewport), f.easing, f.duration);
  };

  return (
    <div className="timeline">
      <div className="timeline-head">
        <strong style={{ fontSize: 13 }}>Timeline</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{frames.length} frames</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => captureFrame()} title="Capture the current view as a frame">
          + Frame from view
        </button>
        <button
          onClick={() => frameToSelection()}
          disabled={selectedCount === 0}
          title="Fit a frame to the selected elements"
        >
          + Frame selection
        </button>
      </div>
      <div className="timeline-strip">
        {frames.map((f, i) => (
          <div
            key={f.id}
            className={`frame-card${f.id === currentFrameId ? " current" : ""}${dragging === i ? " dragging" : ""}`}
            draggable
            onDragStart={() => {
              dragIdx.current = i;
              setDragging(i);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx.current !== null && dragIdx.current !== i) reorderFrames(dragIdx.current, i);
              dragIdx.current = null;
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            onClick={() => goTo(f.id)}
          >
            <Thumbnail presentation={presentation} frame={f} index={i} />
            <div className="frame-meta">
              <span className="idx">{i + 1}</span>
              <input
                value={f.title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateFrame(f.id, { title: e.target.value })}
              />
            </div>
            <div className="row">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateFrame(f.id);
                }}
              >
                Dup
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFrame(f.id);
                }}
              >
                Del
              </button>
            </div>
          </div>
        ))}
        {frames.length === 0 && (
          <div style={{ color: "var(--muted)", alignSelf: "center", padding: "0 12px" }}>
            Pan/zoom the canvas, then press <span className="kbd">+ Frame from view</span> to capture your first shot.
          </div>
        )}
      </div>
    </div>
  );
}
