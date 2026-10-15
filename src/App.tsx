import { useCallback, useEffect, useState } from "react";
import { useStore } from "./store/store";
import { loadLocal } from "./store/persistence";
import { TEMPLATES, blankPresentation } from "./store/templates";
import { Toolbar } from "./components/Toolbar";
import { EditCanvas } from "./components/EditCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Timeline } from "./components/Timeline";
import { Player } from "./components/Player";
import { PresenterView } from "./components/PresenterView";
import { WebImageDialog } from "./components/WebImageDialog";
import { pastedImageText } from "./remote/parseImageInput";

export function App() {
  if (window.location.hash === "#presenter") return <PresenterView />;
  return <Editor />;
}

function Editor() {
  const mode = useStore((s) => s.mode);
  const loadPresentation = useStore((s) => s.loadPresentation);
  const [booted, setBooted] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  /** null = closed; otherwise the text the web-image dialog opens with. */
  const [webDialog, setWebDialog] = useState<string | null>(null);
  const closeWebDialog = useCallback(() => setWebDialog(null), []);

  // Bootstrap: restore autosaved work, else offer a template.
  useEffect(() => {
    loadLocal().then((p) => {
      if (p && (p.elements.length || p.frames.length)) {
        loadPresentation(p);
      } else {
        setShowPicker(true);
      }
      setBooted(true);
    });
  }, [loadPresentation]);

  // Global edit-mode shortcuts. Off while the web-image dialog is open (it handles its own
  // Escape), so undo or Delete can't change the canvas hidden behind it.
  useEffect(() => {
    if (webDialog !== null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? useStore.temporal.getState().redo() : useStore.temporal.getState().undo();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useStore.temporal.getState().redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        const { selectedIds, removeElement } = useStore.getState();
        if (selectedIds.length) {
          e.preventDefault();
          selectedIds.forEach(removeElement);
        }
      } else if (e.key === "Escape" && !typing) {
        useStore.getState().select([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [webDialog]);

  // Pasting an image link or Commons snippet onto the canvas opens the web-image dialog.
  useEffect(() => {
    if (mode !== "edit" || showPicker || webDialog !== null) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      const text = pastedImageText(
        e.clipboardData?.getData("text/html") ?? "",
        e.clipboardData?.getData("text/plain") ?? ""
      );
      if (text === null) return;
      e.preventDefault();
      setWebDialog(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [mode, showPicker, webDialog]);

  if (!booted) return null;
  if (mode === "play") return <Player />;

  return (
    <div className="editor">
      <Toolbar onAddFromWeb={() => setWebDialog("")} />
      <div className="canvas-area">
        <EditCanvas />
      </div>
      <PropertiesPanel />
      <Timeline />
      {webDialog !== null && <WebImageDialog initialText={webDialog} onClose={closeWebDialog} />}
      {showPicker && (
        <div className="modal-bg">
          <div className="modal">
            <h2>Start a presentation</h2>
            <p style={{ color: "var(--muted)" }}>Pick a narrative skeleton, or start from a blank canvas.</p>
            <div className="template-grid">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  className="template-card"
                  onClick={() => {
                    loadPresentation(tpl.build());
                    setShowPicker(false);
                  }}
                >
                  <b>{tpl.name}</b>
                  <span>{tpl.description}</span>
                </button>
              ))}
              <button
                className="template-card"
                onClick={() => {
                  loadPresentation(blankPresentation());
                  setShowPicker(false);
                }}
              >
                <b>Blank canvas</b>
                <span>An empty world. Drop in assets and frame your own shots.</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
