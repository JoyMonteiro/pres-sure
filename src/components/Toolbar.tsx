import { useEffect, useReducer, useRef } from "react";
import { useStore } from "../store/store";
import { exportJson, importJson } from "../store/persistence";
import { exportHtml } from "../export/exportHtml";
import type { ElementType } from "../types";

function useTemporal() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => useStore.temporal.subscribe(() => force()), []);
  return useStore.temporal.getState();
}

const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

const typeFor = (f: File): ElementType =>
  f.type === "image/svg+xml" ? "svg" : f.type === "image/gif" ? "gif" : "image";

export function Toolbar() {
  const title = useStore((s) => s.presentation.title);
  const setTitle = useStore((s) => s.setTitle);
  const addElement = useStore((s) => s.addElement);
  const setMode = useStore((s) => s.setMode);
  const loadPresentation = useStore((s) => s.loadPresentation);
  const temporal = useTemporal();
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const onAddAsset = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const url = await fileToDataUrl(f);
      addElement(typeFor(f), url);
    }
  };

  const openPresenter = () => window.open(`${location.pathname}#presenter`, "pres-sure-presenter", "width=1100,height=720");

  return (
    <div className="toolbar">
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="sep" />
      <div className="group">
        <button onClick={() => addElement("text", "New text")}>+ Text</button>
        <button onClick={() => fileRef.current?.click()}>+ Image / GIF / SVG</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          hidden
          onChange={(e) => {
            onAddAsset(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="sep" />
      <div className="group">
        <button onClick={() => temporal.undo()} disabled={temporal.pastStates.length === 0} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={() => temporal.redo()} disabled={temporal.futureStates.length === 0} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button onClick={() => jsonRef.current?.click()}>Import</button>
        <input
          ref={jsonRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            if (e.target.files?.[0]) loadPresentation(await importJson(e.target.files[0]));
            e.target.value = "";
          }}
        />
        <button onClick={() => exportJson(useStore.getState().presentation)}>Save .json</button>
        <button onClick={() => exportHtml(useStore.getState().presentation)}>Export .html</button>
        <div className="sep" />
        <button onClick={openPresenter} title="Open presenter view in a new window">
          Presenter
        </button>
        <button className="primary" onClick={() => setMode("play")}>
          ▶ Present
        </button>
      </div>
    </div>
  );
}
