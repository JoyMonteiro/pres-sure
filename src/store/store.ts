// Central store: Zustand + immer + zundo (§2.2, §4.8).
// Only `presentation` is tracked in undo/redo history (via partialize). Selection,
// editor camera, viewport, and playback mode are transient and excluded.
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { Camera, Size } from "../camera/camera";
import { boundingBox, cameraToFrameRect, frameToCamera } from "../camera/camera";
import type { Element, ElementType, Frame, Presentation, SceneNode } from "../types";
import { makeElement, makeFrame, makeHold, makeNode, makePresentation, makeRung } from "./factory";
import { resolveTransform, worldRect, worldToLocal } from "../nodes/transform";
import { childrenOf, descendantIds } from "../nodes/tree";
import { holdGroups, isHold, planReveal } from "../playback/holds";
import { debounce, saveLocal } from "./persistence";

export type Mode = "edit" | "play";

export interface Guide {
  axis: "x" | "y";
  pos: number;
}

interface AppState {
  presentation: Presentation;
  selectedIds: string[];
  currentFrameId: string | null;
  editorCamera: Camera;
  viewport: Size;
  mode: Mode;
  guides: Guide[];
  /** The node the author is working inside; null = the world. Transient, like selection. */
  currentNodeId: string | null;

  // --- transient setters (not history-tracked) ---
  setViewport: (s: Size) => void;
  setEditorCamera: (c: Camera) => void;
  setMode: (m: Mode) => void;
  select: (ids: string[]) => void;
  /** Add/remove one id, preserving click order — the order a build reveals in. */
  toggleSelect: (id: string) => void;
  setCurrentFrame: (id: string | null) => void;
  setGuides: (g: Guide[]) => void;
  setCurrentNode: (id: string | null) => void;

  // --- presentation mutations (history-tracked) ---
  loadPresentation: (p: Presentation) => void;
  setTitle: (t: string) => void;
  setBackground: (color: string) => void;

  addElement: (type: ElementType, content: string, extra?: Partial<Element>) => string;
  updateElement: (id: string, patch: Partial<Element>) => void;
  removeElement: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  captureFrame: () => string;
  frameToSelection: (margin?: number) => string | null;
  updateFrame: (id: string, patch: Partial<Frame>) => void;
  recaptureFrame: (id: string) => void;
  duplicateFrame: (id: string) => void;
  removeFrame: (id: string) => void;
  /** Reorder whole groups (a shot plus its holds), by group index — not flat frame index. */
  moveFrameGroup: (from: number, to: number) => void;
  addHoldStep: (shotId: string) => void;
  revealOneAtATime: () => void;

  addRung: (name: string) => string;
  renameRung: (id: string, name: string) => void;
  removeRung: (id: string) => void;
  addNode: (partial: Partial<SceneNode> & Pick<SceneNode, "rungId">) => string;
  updateNode: (id: string, patch: Partial<SceneNode>) => void;
  /**
   * promote: the node goes, its children and elements stay where they look, reparented to
   * its parent. cascade: the node, everything beneath it, and their elements all go.
   */
  removeNode: (id: string, mode: "promote" | "cascade") => void;
  moveElementToNode: (elementId: string, nodeId: string | null) => void;
}

const touch = (p: Presentation) => {
  p.updatedAt = Date.now();
};

const nextZ = (els: Element[]) => (els.length ? Math.max(...els.map((e) => e.z)) + 1 : 0);

export const useStore = create<AppState>()(
  temporal(
    immer<AppState>((set, get) => ({
      presentation: makePresentation(),
      selectedIds: [],
      currentFrameId: null,
      editorCamera: { cx: 0, cy: 0, scale: 1, rotation: 0 },
      viewport: { width: 1280, height: 720 },
      mode: "edit",
      guides: [],
      currentNodeId: null,

      setGuides: (g) => set((st) => void (st.guides = g)),
      setViewport: (s) => set((st) => void (st.viewport = s)),
      setEditorCamera: (c) => set((st) => void (st.editorCamera = c)),
      setMode: (m) => set((st) => void (st.mode = m)),
      select: (ids) => set((st) => void (st.selectedIds = ids)),
      toggleSelect: (id) =>
        set((st) => {
          const i = st.selectedIds.indexOf(id);
          if (i >= 0) st.selectedIds.splice(i, 1);
          else st.selectedIds.push(id); // append: selection order is the reveal order
        }),
      setCurrentFrame: (id) => set((st) => void (st.currentFrameId = id)),
      setCurrentNode: (id) => set((st) => void (st.currentNodeId = id)),

      loadPresentation: (p) =>
        set((st) => {
          st.presentation = p;
          st.selectedIds = [];
          st.currentFrameId = p.frames[0]?.id ?? null;
          st.currentNodeId = null;
        }),

      setTitle: (t) =>
        set((st) => {
          st.presentation.title = t;
          touch(st.presentation);
        }),

      setBackground: (color) =>
        set((st) => {
          st.presentation.world.backgroundColor = color;
          touch(st.presentation);
        }),

      addElement: (type, content, extra) => {
        const el = makeElement(type, { content, ...extra });
        set((st) => {
          el.z = nextZ(st.presentation.elements);
          // Place at current view center if no explicit position given.
          if (extra?.x === undefined) el.x = st.editorCamera.cx - el.w / 2;
          if (extra?.y === undefined) el.y = st.editorCamera.cy - el.h / 2;
          st.presentation.elements.push(el);
          st.selectedIds = [el.id];
          touch(st.presentation);
        });
        return el.id;
      },

      updateElement: (id, patch) =>
        set((st) => {
          const el = st.presentation.elements.find((e) => e.id === id);
          if (!el) return;
          Object.assign(el, patch);
          touch(st.presentation);
        }),

      removeElement: (id) =>
        set((st) => {
          st.presentation.elements = st.presentation.elements.filter((e) => e.id !== id);
          st.selectedIds = st.selectedIds.filter((s) => s !== id);
          touch(st.presentation);
        }),

      bringForward: (id) =>
        set((st) => {
          const el = st.presentation.elements.find((e) => e.id === id);
          if (el) {
            el.z = nextZ(st.presentation.elements);
            touch(st.presentation);
          }
        }),

      sendBackward: (id) =>
        set((st) => {
          const el = st.presentation.elements.find((e) => e.id === id);
          if (el) {
            const min = Math.min(...st.presentation.elements.map((e) => e.z));
            el.z = min - 1;
            touch(st.presentation);
          }
        }),

      captureFrame: () => {
        const { editorCamera, viewport } = get();
        const rect = cameraToFrameRect(editorCamera, viewport);
        const f = makeFrame({
          ...rect,
          title: `Frame ${get().presentation.frames.length + 1}`,
          easing: get().presentation.settings.defaultEasing,
          duration: get().presentation.settings.defaultDuration,
        });
        set((st) => {
          st.presentation.frames.push(f);
          st.currentFrameId = f.id;
          touch(st.presentation);
        });
        return f.id;
      },

      frameToSelection: (margin = 0.12) => {
        const st = get();
        const sel = st.presentation.elements.filter((e) => st.selectedIds.includes(e.id));
        const box = boundingBox(sel);
        if (!box) return null;
        const padX = box.w * margin;
        const padY = box.h * margin;
        const f = makeFrame({
          x: box.x - padX,
          y: box.y - padY,
          w: box.w + padX * 2,
          h: box.h + padY * 2,
          rotation: 0,
          title: `Frame ${st.presentation.frames.length + 1}`,
          easing: st.presentation.settings.defaultEasing,
          duration: st.presentation.settings.defaultDuration,
        });
        set((s) => {
          s.presentation.frames.push(f);
          s.currentFrameId = f.id;
          touch(s.presentation);
        });
        return f.id;
      },

      updateFrame: (id, patch) =>
        set((st) => {
          const f = st.presentation.frames.find((fr) => fr.id === id);
          if (!f) return;
          Object.assign(f, patch);
          touch(st.presentation);
        }),

      recaptureFrame: (id) => {
        const { editorCamera, viewport } = get();
        const rect = cameraToFrameRect(editorCamera, viewport);
        set((st) => {
          const f = st.presentation.frames.find((fr) => fr.id === id);
          if (!f) return;
          Object.assign(f, rect);
          touch(st.presentation);
        });
      },

      duplicateFrame: (id) =>
        set((st) => {
          const idx = st.presentation.frames.findIndex((f) => f.id === id);
          if (idx < 0) return;
          const src = st.presentation.frames[idx];
          const copy = makeFrame({ ...src, title: `${src.title} copy` });
          st.presentation.frames.splice(idx + 1, 0, copy);
          st.currentFrameId = copy.id;
          touch(st.presentation);
        }),

      addHoldStep: (shotId) =>
        set((st) => {
          const frames = st.presentation.frames;
          const idx = frames.findIndex((f) => f.id === shotId);
          if (idx < 0) return;
          let end = idx;
          while (end + 1 < frames.length && isHold(frames[end + 1])) end++;
          const stepNo = end - idx + 2; // existing holds + the shot itself + 1
          const h = makeHold({ title: `Step ${stepNo}` });
          frames.splice(end + 1, 0, h);
          st.currentFrameId = h.id;
          touch(st.presentation);
        }),

      revealOneAtATime: () => {
        const st = get();
        const plan = planReveal(st.presentation.frames, st.selectedIds, st.currentFrameId, (title) =>
          makeHold({ title })
        );
        if (!plan) return;
        // One set() so the whole build is a single undo entry.
        set((s) => {
          s.presentation.frames.splice(plan.insertAt, 0, ...plan.holds);
          plan.assignments.forEach((frameId, elId) => {
            const el = s.presentation.elements.find((e) => e.id === elId);
            if (!el) return;
            el.lifecycle.enterAt = frameId;
            // Upgrade only from "none": an entrance the author chose is never overwritten.
            // Without an effect the reveal is a hard pop, since `entering` needs enterAt.
            if (el.lifecycle.enterEffect === "none") el.lifecycle.enterEffect = "fade";
          });
          touch(s.presentation);
        });
      },

      removeFrame: (id) =>
        set((st) => {
          const frames = st.presentation.frames;
          const idx = frames.findIndex((f) => f.id === id);
          if (idx < 0) return;

          // Deleting a shot takes its holds with it — a surviving hold would inherit some
          // unrelated shot's camera.
          const doomed = [frames[idx].id];
          if (!isHold(frames[idx])) {
            for (let j = idx + 1; j < frames.length && isHold(frames[j]); j++) doomed.push(frames[j].id);
          }

          // Elements pointed at a deleted *hold* fall back to the preceding frame, so the
          // build loses a step instead of collapsing. Deleting a shot keeps today's
          // dangling-enterAt behaviour: that wart is explicitly out of scope (spec §9).
          const holdIds = doomed.filter((d) => isHold(frames.find((f) => f.id === d)!));
          const fallback = frames[idx - 1]?.id ?? null;
          if (holdIds.length) {
            st.presentation.elements.forEach((el) => {
              if (el.lifecycle.enterAt && holdIds.includes(el.lifecycle.enterAt)) {
                el.lifecycle.enterAt = fallback;
              }
              if (el.lifecycle.exitAt && holdIds.includes(el.lifecycle.exitAt)) {
                el.lifecycle.exitAt = fallback;
              }
            });
          }

          st.presentation.frames = frames.filter((f) => !doomed.includes(f.id));
          if (st.currentFrameId && doomed.includes(st.currentFrameId)) {
            st.currentFrameId = st.presentation.frames[0]?.id ?? null;
          }
          touch(st.presentation);
        }),

      moveFrameGroup: (from, to) =>
        set((st) => {
          const groups = holdGroups(st.presentation.frames);
          if (from < 0 || from >= groups.length || to < 0 || to >= groups.length) return;
          const [m] = groups.splice(from, 1);
          groups.splice(to, 0, m);
          // Rebuilding from groups is what keeps holds behind their shot: there is no
          // ordering a drag can produce that separates them.
          st.presentation.frames = groups.flatMap((g) => [g.shot, ...g.holds]);
          touch(st.presentation);
        }),

      // --- the scale ladder (§2.3) ---
      // `rungs` and `nodes` are absent on decks authored before the ladder existed, so
      // adding the first one creates the array and removing the last takes it away again:
      // a deck that never had a ladder and one whose ladder was emptied must save the same.

      addRung: (name) => {
        const rung = makeRung(name);
        set((st) => {
          (st.presentation.rungs ??= []).push(rung);
          touch(st.presentation);
        });
        return rung.id;
      },

      renameRung: (id, name) =>
        set((st) => {
          const rung = st.presentation.rungs?.find((r) => r.id === id);
          if (!rung) return;
          rung.name = name;
          touch(st.presentation);
        }),

      removeRung: (id) =>
        set((st) => {
          const rungs = st.presentation.rungs;
          if (!rungs?.some((r) => r.id === id)) return;
          const left = rungs.filter((r) => r.id !== id);
          if (left.length) st.presentation.rungs = left;
          else delete st.presentation.rungs;
          // The places outlive the label: a node whose rung is gone keeps its id, its
          // parent and its scale, and simply no longer names a scale on the ladder.
          st.presentation.nodes?.forEach((n) => {
            if (n.rungId === id) n.rungId = "";
          });
          touch(st.presentation);
        }),

      addNode: (partial) => {
        const node = makeNode(partial);
        set((st) => {
          (st.presentation.nodes ??= []).push(node);
          touch(st.presentation);
        });
        return node.id;
      },

      updateNode: (id, patch) =>
        set((st) => {
          const node = st.presentation.nodes?.find((n) => n.id === id);
          if (!node) return;
          Object.assign(node, patch);
          touch(st.presentation);
        }),

      removeNode: (id, mode) =>
        set((st) => {
          const pres = st.presentation;
          const all = pres.nodes ?? [];
          const victim = all.find((n) => n.id === id);
          if (!victim) return;
          // Read the vanishing node's placement before anything is rewritten.
          const { x: vx, y: vy, scale: vs, parentId: parent } = victim;

          if (mode === "promote") {
            // The node's local units disappear with it, so everything expressed in them
            // is converted into the parent's: a child's offset and scale, and an
            // element's rect and font size. Nothing may move on screen.
            for (const child of childrenOf(all, id)) {
              child.x = vx + child.x * vs;
              child.y = vy + child.y * vs;
              child.scale *= vs;
              child.parentId = parent;
            }
            for (const el of pres.elements) {
              if (el.nodeId !== id) continue;
              el.x = vx + el.x * vs;
              el.y = vy + el.y * vs;
              el.w *= vs;
              el.h *= vs;
              if (el.textStyle) el.textStyle.fontSize *= vs;
              if (parent) el.nodeId = parent;
              else delete el.nodeId;
            }
          }

          const gone = new Set(mode === "cascade" ? [id, ...descendantIds(all, id)] : [id]);

          if (mode === "cascade") {
            const doomedEls = pres.elements.filter((e) => e.nodeId && gone.has(e.nodeId));
            const doomedIds = new Set(doomedEls.map((e) => e.id));
            pres.elements = pres.elements.filter((e) => !doomedIds.has(e.id));
            st.selectedIds = st.selectedIds.filter((sid) => !doomedIds.has(sid));
          }

          // A frame keeps its geometry and loses only its label. Frame rects are world
          // space (see captureFrame), so an unlabelled frame points exactly where it did;
          // deleting the author's shots because a node went away is data loss nothing
          // asked for, and relabelling to the parent is the one option that could move a
          // camera if that world-space reading ever changes.
          for (const f of pres.frames) if (f.nodeId && gone.has(f.nodeId)) delete f.nodeId;

          const left = all.filter((n) => !gone.has(n.id));
          if (left.length) pres.nodes = left;
          else delete pres.nodes;

          // Working inside a node that no longer exists would leave the author editing a
          // scale with no place on the tree, so fall back to where the node hung.
          if (st.currentNodeId && gone.has(st.currentNodeId)) st.currentNodeId = parent;

          touch(pres);
        }),

      moveElementToNode: (elementId, nodeId) =>
        set((st) => {
          const pres = st.presentation;
          const el = pres.elements.find((e) => e.id === elementId);
          if (!el) return;
          const all = pres.nodes ?? [];
          if (nodeId && !all.some((n) => n.id === nodeId)) return;

          // Re-express the element in the destination's units via its world rect, so the
          // element stays exactly where it is and only its numbers change.
          const world = worldRect(el, all);
          const fontWorld = el.textStyle
            ? el.textStyle.fontSize * resolveTransform(all, el.nodeId).s
            : 0;
          const t = resolveTransform(all, nodeId);
          const local = worldToLocal({ x: world.x, y: world.y }, t);
          el.x = local.x;
          el.y = local.y;
          // A zero-scale destination has no units to divide by; leave the size alone
          // rather than writing Infinity into stored data.
          if (t.s !== 0) {
            el.w = world.w / t.s;
            el.h = world.h / t.s;
            if (el.textStyle) el.textStyle.fontSize = fontWorld / t.s;
          }
          if (nodeId) el.nodeId = nodeId;
          else delete el.nodeId;
          touch(pres);
        }),
    })),
    {
      limit: 100,
      partialize: (state) => ({ presentation: state.presentation }) as AppState,
      equality: (a, b) => a.presentation === b.presentation,
    }
  )
);

// --- Autosave: persist presentation changes to IndexedDB, debounced (§2.4). ---
const autosave = debounce((p: Presentation) => void saveLocal(p), 500);
useStore.subscribe((state, prev) => {
  if (state.presentation !== prev.presentation) autosave(state.presentation);
});

// Convenience camera helper used by selection-fitting UI.
export const cameraForFrame = (frame: Frame, viewport: Size): Camera =>
  frameToCamera(frame, viewport);
