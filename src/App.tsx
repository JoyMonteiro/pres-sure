import { useEffect, useState } from "react";
import { useStore } from "./store/store";
import { loadLocal } from "./store/persistence";
import { TEMPLATES, blankPresentation } from "./store/templates";
import { Toolbar } from "./components/Toolbar";
import { EditCanvas } from "./components/EditCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Timeline } from "./components/Timeline";
import { Player } from "./components/Player";
import { PresenterView } from "./components/PresenterView";
import { ConflictBanner, FolderOverlay } from "./components/FolderUI";
import { checkForExternalChange, installFolderAutosave, restoreRememberedFolder } from "./folder/controller";
import { isEditingLocked } from "./folder/folderStore";

export function App() {
  if (window.location.hash === "#presenter") return <PresenterView />;
  return <Editor />;
}

function Editor() {
  const mode = useStore((s) => s.mode);
  const loadPresentation = useStore((s) => s.loadPresentation);
  const [booted, setBooted] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Bootstrap: restore autosaved work, else offer a template. A remembered lecture folder
  // shows the reopen overlay instead of the template picker.
  useEffect(() => {
    installFolderAutosave();
    (async () => {
      const p = await loadLocal();
      const remembered = await restoreRememberedFolder();
      if (p && (p.elements.length || p.frames.length)) {
        loadPresentation(p);
      } else if (!remembered) {
        setShowPicker(true);
      }
      setBooted(true);
    })();
  }, [loadPresentation]);

  // Returning to the tab after a git pull: check whether the deck changed on disk (spec D10).
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void checkForExternalChange();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Global edit-mode shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingLocked()) return; // the reopen overlay is up — the canvas is read-only
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
  }, []);

  if (!booted) return null;
  if (mode === "play") return <Player />;

  return (
    <div className="editor">
      <Toolbar />
      <div className="canvas-area">
        <EditCanvas />
      </div>
      <PropertiesPanel />
      <Timeline />
      <FolderOverlay />
      <ConflictBanner />
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
