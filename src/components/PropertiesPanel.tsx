import { useState } from "react";
import { useStore } from "../store/store";
import { EASING_PRESETS } from "../camera/easing";
import { holdGroups, isHold } from "../playback/holds";
import { copyRemoteImage, hostOf, isRemoteUrl } from "../remote/copyRemote";
import type { Element, EnterEffect, ExitEffect, SlideDirection } from "../types";

const num = (v: string, fb = 0) => (v === "" || isNaN(+v) ? fb : +v);

export function PropertiesPanel() {
  const elements = useStore((s) => s.presentation.elements);
  const frames = useStore((s) => s.presentation.frames);
  const selectedIds = useStore((s) => s.selectedIds);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const bg = useStore((s) => s.presentation.world.backgroundColor);
  const setBackground = useStore((s) => s.setBackground);

  const sel = elements.find((e) => selectedIds.length === 1 && e.id === selectedIds[0]);

  return (
    <div className="props">
      {sel ? (
        <ElementProps id={sel.id} />
      ) : selectedIds.length > 1 ? (
        <MultiElementProps />
      ) : (
        <FrameProps id={currentFrameId} />
      )}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
      <h3>World</h3>
      <div className="field">
        <label>Background</label>
        <input type="color" value={bg} onChange={(e) => setBackground(e.target.value)} />
      </div>
      {!sel && frames.length === 0 && <p className="hint">Add elements and capture frames to begin.</p>}
    </div>
  );
}

function ElementProps({ id }: { id: string }) {
  const el = useStore((s) => s.presentation.elements.find((e) => e.id === id))!;
  const frames = useStore((s) => s.presentation.frames);
  const update = useStore((s) => s.updateElement);
  const remove = useStore((s) => s.removeElement);
  const bringForward = useStore((s) => s.bringForward);
  const sendBackward = useStore((s) => s.sendBackward);
  if (!el) return null;
  const lc = el.lifecycle;

  return (
    <>
      <h3>{el.type} element</h3>
      <div className="field row2">
        <div>
          <label>X</label>
          <input type="number" value={Math.round(el.x)} onChange={(e) => update(id, { x: num(e.target.value) })} />
        </div>
        <div>
          <label>Y</label>
          <input type="number" value={Math.round(el.y)} onChange={(e) => update(id, { y: num(e.target.value) })} />
        </div>
      </div>
      <div className="field row2">
        <div>
          <label>W</label>
          <input type="number" value={Math.round(el.w)} onChange={(e) => update(id, { w: num(e.target.value, 1) })} />
        </div>
        <div>
          <label>H</label>
          <input type="number" value={Math.round(el.h)} onChange={(e) => update(id, { h: num(e.target.value, 1) })} />
        </div>
      </div>
      <div className="field">
        <label>Rotation°</label>
        <input type="number" value={el.rotation} onChange={(e) => update(id, { rotation: num(e.target.value) })} />
      </div>

      {el.type === "text" && el.textStyle && (
        <>
          <div className="field row2">
            <div>
              <label>Font size</label>
              <input
                type="number"
                value={el.textStyle.fontSize}
                onChange={(e) => update(id, { textStyle: { ...el.textStyle!, fontSize: num(e.target.value, 12) } })}
              />
            </div>
            <div>
              <label>Weight</label>
              <input
                type="number"
                value={el.textStyle.fontWeight}
                onChange={(e) => update(id, { textStyle: { ...el.textStyle!, fontWeight: num(e.target.value, 400) } })}
              />
            </div>
          </div>
          <div className="field row2">
            <div>
              <label>Color</label>
              <input
                type="color"
                value={el.textStyle.color}
                onChange={(e) => update(id, { textStyle: { ...el.textStyle!, color: e.target.value } })}
              />
            </div>
            <div>
              <label>Align</label>
              <select
                value={el.textStyle.align}
                onChange={(e) =>
                  update(id, { textStyle: { ...el.textStyle!, align: e.target.value as "left" | "center" | "right" } })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
        </>
      )}

      {el.type !== "text" && isRemoteUrl(el.content) && <LinkedImageField id={id} url={el.content} />}

      <h3 style={{ marginTop: 14 }}>Lifecycle</h3>
      <div className="field">
        <label>Enters at</label>
        <select value={lc.enterAt ?? ""} onChange={(e) => update(id, { lifecycle: { ...lc, enterAt: e.target.value || null } })}>
          <option value="">From start</option>
          {frames.map((f, i) => (
            <option key={f.id} value={f.id}>
              {i + 1}. {f.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Entrance effect</label>
        <select
          value={lc.enterEffect}
          onChange={(e) => update(id, { lifecycle: { ...lc, enterEffect: e.target.value as EnterEffect } })}
        >
          {["none", "appear", "fade", "slide", "pulse"].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
      {lc.enterEffect === "slide" && (
        <div className="field">
          <label>Slide from</label>
          <select
            value={lc.enterDirection ?? "left"}
            onChange={(e) => update(id, { lifecycle: { ...lc, enterDirection: e.target.value as SlideDirection } })}
          >
            {["left", "right", "up", "down"].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label>On exit</label>
        <select value={lc.onExit} onChange={(e) => update(id, { lifecycle: { ...lc, onExit: e.target.value as "persist" | "leave" } })}>
          <option value="persist">Persist (stays visible)</option>
          <option value="leave">Leave (removed after its frame)</option>
        </select>
      </div>
      {lc.onExit === "leave" && (
        <>
          <div className="field">
            <label>Leaves after</label>
            <select value={lc.exitAt ?? ""} onChange={(e) => update(id, { lifecycle: { ...lc, exitAt: e.target.value || null } })}>
              <option value="">Its entrance frame</option>
              {frames.map((f, i) => (
                <option key={f.id} value={f.id}>
                  {i + 1}. {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Exit effect</label>
            <select value={lc.exitEffect ?? "fade"} onChange={(e) => update(id, { lifecycle: { ...lc, exitEffect: e.target.value as ExitEffect } })}>
              {["none", "fade", "slide"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="field row2" style={{ marginTop: 8 }}>
        <button onClick={() => bringForward(id)}>Bring forward</button>
        <button onClick={() => sendBackward(id)}>Send back</button>
      </div>
      <button style={{ width: "100%", borderColor: "var(--danger)", color: "var(--danger)" }} onClick={() => remove(id)}>
        Delete element
      </button>
    </>
  );
}

/** A linked web image: say where it comes from, and offer to store a copy (spec §4 UI). */
function LinkedImageField({ id, url }: { id: string; url: string }) {
  const update = useStore((s) => s.updateElement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCopy = async () => {
    setBusy(true);
    setError(null);
    try {
      update(id, { content: await copyRemoteImage(url) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>Linked from {hostOf(url)} — needs internet to show</label>
      <button disabled={busy} onClick={saveCopy}>
        {busy ? "Downloading…" : "Save a copy"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function FrameProps({ id }: { id: string | null }) {
  const frame = useStore((s) => s.presentation.frames.find((f) => f.id === id));
  const frames = useStore((s) => s.presentation.frames);
  const update = useStore((s) => s.updateFrame);
  const recapture = useStore((s) => s.recaptureFrame);
  if (!frame) return <h3>No frame selected</h3>;
  if (isHold(frame)) {
    // A hold has no camera move, so transition feel, duration and re-capture are all
    // meaningless for it — only its title and notes are editable.
    const group = holdGroups(frames).find((g) => g.holds.some((h) => h.id === frame.id));
    return (
      <>
        <h3>Reveal step</h3>
        <div className="field">
          <label>Title</label>
          <input value={frame.title} onChange={(e) => update(frame.id, { title: e.target.value })} />
        </div>
        <div className="field">
          <label>Speaker notes</label>
          <textarea rows={5} value={frame.notes} onChange={(e) => update(frame.id, { notes: e.target.value })} />
        </div>
        <p className="hint">
          Camera inherited from “{group?.shot.title ?? "the preceding frame"}”. Advancing to this
          step reveals its elements without moving the camera.
        </p>
      </>
    );
  }
  const isSpring = frame.easing === "snappy";

  return (
    <>
      <h3>Frame</h3>
      <div className="field">
        <label>Title</label>
        <input value={frame.title} onChange={(e) => update(frame.id, { title: e.target.value })} />
      </div>
      <div className="field">
        <label>Transition feel</label>
        <select value={frame.easing} onChange={(e) => update(frame.id, { easing: e.target.value as typeof frame.easing })}>
          {EASING_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {!isSpring && frame.easing !== "cut" && (
        <div className="field">
          <label>Duration</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={frame.duration === "auto"}
                onChange={(e) => update(frame.id, { duration: e.target.checked ? "auto" : 900 })}
              />
              auto
            </label>
            {frame.duration !== "auto" && (
              <input
                type="number"
                style={{ flex: 1 }}
                value={frame.duration}
                onChange={(e) => update(frame.id, { duration: num(e.target.value, 100) })}
              />
            )}
            {frame.duration !== "auto" && <span style={{ color: "var(--muted)", fontSize: 12 }}>ms</span>}
          </div>
          {frame.duration === "auto" && <p className="hint">Distance-aware: longer journeys take longer.</p>}
        </div>
      )}
      {isSpring && <p className="hint">Spring transition — duration is governed by the spring.</p>}
      <div className="field">
        <label>Speaker notes</label>
        <textarea rows={5} value={frame.notes} onChange={(e) => update(frame.id, { notes: e.target.value })} />
      </div>
      <button style={{ width: "100%" }} onClick={() => recapture(frame.id)}>
        Re-capture from current view
      </button>
    </>
  );
}

/** Shown for a 2+ element selection: the reveal builder (spec §5). */
function MultiElementProps() {
  const selectedIds = useStore((s) => s.selectedIds);
  const elements = useStore((s) => s.presentation.elements);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const frames = useStore((s) => s.presentation.frames);
  const reveal = useStore((s) => s.revealOneAtATime);

  const chosen = selectedIds
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is Element => !!e);
  const anchor = frames.find((f) => f.id === currentFrameId);

  return (
    <>
      <h3>{chosen.length} elements selected</h3>
      <ol className="sel-list">
        {chosen.map((e, i) => (
          <li key={e.id}>
            <span className="idx">{i + 1}</span> {elementLabel(e)}
          </li>
        ))}
      </ol>
      <button style={{ width: "100%" }} disabled={!anchor} onClick={() => reveal()}>
        Reveal one at a time
      </button>
      <p className="hint">
        {anchor
          ? `Element 1 appears with “${anchor.title}”; each of the others gets its own step. Existing entrance frames are overwritten.`
          : "Select a frame in the timeline first."}
      </p>
    </>
  );
}

/** Short human label for the selection list — text content, or just the type. */
function elementLabel(e: Element): string {
  if (e.type !== "text") return e.type;
  const plain = e.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "text";
  return plain.length > 28 ? `${plain.slice(0, 28)}…` : plain;
}
