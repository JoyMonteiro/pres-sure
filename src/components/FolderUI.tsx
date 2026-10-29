import { useFolderStore } from "../folder/folderStore";
import {
  canOpenFolders,
  closeFolder,
  forgetFolder,
  pickFolder,
  reopenFolder,
  resolveConflict,
} from "../folder/controller";

/** Toolbar: "Open folder…" or the open folder's name and save state. */
export function FolderChip() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  const saving = useFolderStore((s) => s.saving);
  const error = useFolderStore((s) => s.error);

  if (status === "none" || status === "needsPermission") {
    if (!canOpenFolders()) return null;
    return (
      <button onClick={() => void pickFolder()} title="Keep this lecture in a folder, with images as separate files">
        📁 Open folder…
      </button>
    );
  }

  const label =
    status === "conflict"
      ? "conflict"
      : saving === "error"
        ? "error"
        : saving === "saving" || saving === "pending"
          ? "saving…"
          : "saved";
  const bad = label === "conflict" || label === "error";
  return (
    <span className={`folder-chip${bad ? " bad" : ""}`} title={error ?? `Saving to the folder “${name}”`}>
      📁 {name} · {label}
      <button className="chip-btn" onClick={() => void pickFolder()} title="Open a different folder">
        ⇄
      </button>
      <button className="chip-btn" onClick={() => void closeFolder()} title="Close the folder (images are embedded again)">
        ×
      </button>
    </span>
  );
}

/** Boot-time overlay: the remembered folder needs permission again (spec §4). */
export function FolderOverlay() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  if (status !== "needsPermission") return null;
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Reopen 📁 {name}?</h2>
        <p style={{ color: "var(--muted)" }}>
          Your browser needs permission again to edit this lecture folder. Until then, the canvas shows the last
          autosaved copy, read-only.
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={() => void reopenFolder()}>
            Reopen 📁 {name}
          </button>
          <button onClick={() => void forgetFolder()}>Forget folder</button>
        </div>
      </div>
    </div>
  );
}

/** Shown when deck.pressure.json changed on disk behind the editor's back (spec D10). */
export function ConflictBanner() {
  const status = useFolderStore((s) => s.status);
  const name = useFolderStore((s) => s.name);
  if (status !== "conflict") return null;
  return (
    <div className="conflict-banner" role="alert">
      <span>
        <b>deck.pressure.json</b> in 📁 {name} changed outside the editor (git pull?). Saving is paused.
      </span>
      <button onClick={() => void resolveConflict("disk")}>Load from disk</button>
      <button onClick={() => void resolveConflict("mine")}>Keep mine</button>
    </div>
  );
}
