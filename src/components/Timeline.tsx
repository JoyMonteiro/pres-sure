import { useRef, useState } from "react";
import { useStore } from "../store/store";
import { frameToCamera } from "../camera/camera";
import { holdGroups, resolveFrameRect } from "../playback/holds";
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
  const moveFrameGroup = useStore((s) => s.moveFrameGroup);
  const addHoldStep = useStore((s) => s.addHoldStep);
  const updateFrame = useStore((s) => s.updateFrame);
  const selectedCount = useStore((s) => s.selectedIds.length);
  const cameraTo = useCameraTo();

  const dragIdx = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const groups = holdGroups(frames);

  // Index is needed as well as id: a hold's camera comes from its position in the list.
  const goTo = (id: string, index: number) => {
    const f = frames[index];
    const rect = resolveFrameRect(frames, index);
    if (!f || !rect) return;
    setCurrentFrame(id);
    cameraTo(frameToCamera(rect, viewport), f.easing, f.duration);
  };

  return (
    <div className="timeline">
      <div className="timeline-head">
        <strong style={{ fontSize: 13 }}>Timeline</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {groups.length} shots · {frames.length} steps
        </span>
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
        {groups.map((g, gi) => (
          <div
            className="frame-group"
            key={g.shot.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx.current !== null && dragIdx.current !== gi) moveFrameGroup(dragIdx.current, gi);
              dragIdx.current = null;
              setDragging(null);
            }}
          >
            <div
              className={`frame-card${g.shot.id === currentFrameId ? " current" : ""}${
                dragging === gi ? " dragging" : ""
              }`}
              draggable
              onDragStart={() => {
                dragIdx.current = gi;
                setDragging(gi);
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => goTo(g.shot.id, g.startIndex)}
            >
              <Thumbnail presentation={presentation} frame={g.shot} index={g.startIndex} />
              <div className="frame-meta">
                <span className="idx">{gi + 1}</span>
                <input
                  value={g.shot.title}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateFrame(g.shot.id, { title: e.target.value })}
                />
              </div>
              <div className="row">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateFrame(g.shot.id);
                  }}
                >
                  Dup
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFrame(g.shot.id);
                  }}
                  title="Delete this shot and its reveal steps"
                >
                  Del
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addHoldStep(g.shot.id);
                  }}
                  title="Add a reveal step that keeps this camera"
                >
                  + Step
                </button>
              </div>
            </div>
            {g.holds.map((h, hi) => (
              <div
                key={h.id}
                className={`hold-tick${h.id === currentFrameId ? " current" : ""}`}
                title={`${h.title} — same camera as “${g.shot.title}”`}
                onClick={() => goTo(h.id, g.startIndex + 1 + hi)}
              >
                <span className="tick-idx">{hi + 2}</span>
                <button
                  className="tick-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFrame(h.id);
                  }}
                  title="Delete this step"
                >
                  ×
                </button>
              </div>
            ))}
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
