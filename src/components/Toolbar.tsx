import { useEffect, useReducer, useRef } from "react";
import { useStore } from "../store/store";
import { addImageFiles, downloadHtml, downloadJson, importDeckFile } from "../folder/controller";
import { FolderChip } from "./FolderUI";

function useTemporal() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => useStore.temporal.subscribe(() => force()), []);
  return useStore.temporal.getState();
}

export function Toolbar() {
  const title = useStore((s) => s.presentation.title);
  const setTitle = useStore((s) => s.setTitle);
  const addElement = useStore((s) => s.addElement);
  const setMode = useStore((s) => s.setMode);
  const temporal = useTemporal();
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

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
            // Copy the list before clearing the input — clearing empties the live FileList.
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addImageFiles(files);
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
        <FolderChip />
        <div className="sep" />
        <button onClick={() => jsonRef.current?.click()}>Import</button>
        <input
          ref={jsonRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importDeckFile(file);
          }}
        />
        <button onClick={() => void downloadJson()}>Save .json</button>
        <button onClick={() => void downloadHtml()}>Export .html</button>
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
