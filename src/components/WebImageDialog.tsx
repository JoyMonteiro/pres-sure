import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import { parseImageInput } from "../remote/parseImageInput";
import { resolveInput, type ResolvedImage } from "../remote/resolveImage";
import { fetchJson, probeSize } from "../remote/browser";
import { copyRemoteImage } from "../remote/copyRemote";
import { layoutWebImage } from "../remote/layoutWebImage";

type Status =
  | { kind: "empty" }
  | { kind: "resolving" }
  | { kind: "error"; message: string }
  | { kind: "ready"; image: ResolvedImage };

const RESOLVE_DELAY_MS = 400;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "+ From web": paste a Wikimedia snippet/link or an image URL, preview, add (spec §4 UI). */
export function WebImageDialog({ initialText, onClose }: { initialText: string; onClose: () => void }) {
  const webDefault = useStore((s) => s.presentation.settings.webImages ?? "link");
  const [text, setText] = useState(initialText);
  const [copy, setCopy] = useState(webDefault === "copy");
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Resolve once typing pauses; the cleanup discards any older in-flight result.
  useEffect(() => {
    if (!text.trim()) {
      setStatus({ kind: "empty" });
      return;
    }
    const input = parseImageInput(text);
    if (input.kind === "invalid") {
      setStatus({ kind: "error", message: input.message });
      return;
    }
    let stale = false;
    setStatus({ kind: "resolving" });
    const timer = setTimeout(() => {
      resolveInput(input, { fetchJson, probeSize }).then(
        (image) => !stale && setStatus({ kind: "ready", image }),
        (e: unknown) => !stale && setStatus({ kind: "error", message: messageOf(e) })
      );
    }, RESOLVE_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async () => {
    if (status.kind !== "ready") return;
    const r = status.image;
    setAdding(true);
    setAddError(null);
    let content = r.url;
    if (copy) {
      try {
        content = await copyRemoteImage(r.url);
      } catch (e) {
        // Clear the box so the next click on Add links the image instead (spec D9).
        setAddError(messageOf(e));
        setCopy(false);
        setAdding(false);
        return;
      }
    }
    const { editorCamera, setWebImagesDefault, addElements } = useStore.getState();
    const layout = layoutWebImage(r, editorCamera);
    // Before addElements, so the first undo after Add removes the image and its caption.
    setWebImagesDefault(copy ? "copy" : "link");
    addElements([
      { type: r.type, content, extra: layout.image },
      ...(layout.caption ? [{ type: "text" as const, ...layout.caption }] : []),
    ]);
    onClose();
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal web-image-dialog">
        <h2>Add an image from the web</h2>
        <textarea
          autoFocus
          rows={4}
          value={text}
          placeholder="Paste a Wikimedia link, the embed snippet from “Use this file on the web”, or an image URL"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="web-image-status">
          {status.kind === "resolving" && <span className="hint">Looking up…</span>}
          {status.kind === "error" && <span className="error">{status.message}</span>}
          {status.kind === "ready" && (
            <div className="web-image-preview">
              <img src={status.image.url} alt="" />
              <div>
                {status.image.credit && <div>{status.image.credit}</div>}
                {status.image.naturalW && (
                  <div className="hint">
                    {status.image.naturalW} × {status.image.naturalH} px
                  </div>
                )}
                {status.image.lowRes && (
                  <div className="error">Low resolution — Wikimedia couldn't be reached</div>
                )}
              </div>
            </div>
          )}
        </div>
        <label className="web-image-copy">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Save a copy in the project
        </label>
        {addError && <div className="error">{addError}</div>}
        <div className="web-image-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={status.kind !== "ready" || adding} onClick={add}>
            {adding ? "Downloading…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
