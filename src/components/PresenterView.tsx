import { useEffect, useRef, useState } from "react";
import type { Size } from "../camera/camera";
import { frameToCamera } from "../camera/camera";
import { loadFolderHandle, loadLocal } from "../store/persistence";
import { fsAccessFolder } from "../folder/folderIO";
import { setRegistryFolder } from "../folder/assetRegistry";
import { resolveFrameRect } from "../playback/holds";
import { openChannel, type PlaybackMsg } from "../playback/sync";
import type { Presentation } from "../types";
import { Stage } from "./Stage";

/** Presenter view (§4.6) — separate window, follows the audience via BroadcastChannel. */
export function PresenterView() {
  const [pres, setPres] = useState<Presentation | null>(null);
  const [index, setIndex] = useState(0);
  const [start] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  // In folder mode the deck holds asset paths; read them through the remembered folder.
  // Chrome grants folder permission per site, so this is normally already "granted".
  const [needsGrant, setNeedsGrant] = useState<FileSystemDirectoryHandle | null>(null);
  useEffect(() => {
    loadFolderHandle()
      .then(async (h) => {
        if (!h) return;
        if ((await h.queryPermission({ mode: "read" })) === "granted") setRegistryFolder(fsAccessFolder(h));
        else setNeedsGrant(h);
      })
      .catch(() => {});
  }, []);

  const grant = async () => {
    if (!needsGrant) return;
    if ((await needsGrant.requestPermission({ mode: "read" })) === "granted") {
      setRegistryFolder(fsAccessFolder(needsGrant));
      setNeedsGrant(null);
    }
  };

  useEffect(() => {
    loadLocal().then((p) => p && setPres(p));
    const ch = openChannel();
    ch.onmessage = (e: MessageEvent<PlaybackMsg>) => {
      if (e.data?.type === "state") setIndex(e.data.index);
    };
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      ch.close();
      clearInterval(t);
    };
  }, [start]);

  if (!pres) return <div style={{ padding: 24 }}>Open a presentation in the editor, then start presenting.</div>;
  const frames = pres.frames;
  const cur = frames[index];
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="presenter">
      <div className="stage cur">
        <span className="label">Current — {index + 1}/{frames.length}</span>
        {cur && <PreviewPane pres={pres} index={index} />}
      </div>
      <div className="stage next">
        <span className="label">Next</span>
        {frames[index + 1] ? (
          <PreviewPane pres={pres} index={index + 1} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#777" }}>End</div>
        )}
        <div className="clock" style={{ position: "absolute", top: 6, right: 10 }}>
          {mm}:{ss}
        </div>
      </div>
      <div className="notes">
        {needsGrant && (
          <button className="primary" onClick={() => void grant()} style={{ marginBottom: 8 }}>
            Grant access to 📁 {needsGrant.name} to show images
          </button>
        )}
        <strong>Notes</strong>
        <div>{cur?.notes || "—"}</div>
      </div>
    </div>
  );
}

function PreviewPane({ pres, index }: { pres: Presentation; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 640, height: 360 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frame = pres.frames[index];
  // A hold stores a placeholder rect, so the camera must be resolved from its shot —
  // element visibility is index-driven and already correct.
  const rect = resolveFrameRect(pres.frames, index);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {frame && rect && (
        <Stage presentation={pres} camera={frameToCamera(rect, size)} viewport={size} currentIndex={index} animate={false} />
      )}
    </div>
  );
}
