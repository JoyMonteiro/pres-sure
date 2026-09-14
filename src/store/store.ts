// Central store: Zustand + immer + zundo (§2.2, §4.8).
// Only `presentation` is tracked in undo/redo history (via partialize). Selection,
// editor camera, viewport, and playback mode are transient and excluded.
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { Camera, Size } from "../camera/camera";
import { boundingBox, cameraToFrameRect, frameToCamera } from "../camera/camera";
import type { Element, ElementType, Frame, Presentation } from "../types";
import { makeElement, makeFrame, makeHold, makePresentation } from "./factory";
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

  // --- transient setters (not history-tracked) ---
  setViewport: (s: Size) => void;
  setEditorCamera: (c: Camera) => void;
  setMode: (m: Mode) => void;
  select: (ids: string[]) => void;
  /** Add/remove one id, preserving click order — the order a build reveals in. */
  toggleSelect: (id: string) => void;
  setCurrentFrame: (id: string | null) => void;
  setGuides: (g: Guide[]) => void;

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

      loadPresentation: (p) =>
        set((st) => {
          st.presentation = p;
          st.selectedIds = [];
          st.currentFrameId = p.frames[0]?.id ?? null;
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
