// Central store: Zustand + immer + zundo (§2.2, §4.8).
// Only `presentation` is tracked in undo/redo history (via partialize). Selection,
// editor camera, viewport, and playback mode are transient and excluded.
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { Camera, Size } from "../camera/camera";
import { boundingBox, cameraToFrameRect, frameToCamera } from "../camera/camera";
import type { Element, ElementType, Frame, Presentation } from "../types";
import { makeElement, makeFrame, makePresentation } from "./factory";
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
  reorderFrames: (from: number, to: number) => void;
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

      removeFrame: (id) =>
        set((st) => {
          st.presentation.frames = st.presentation.frames.filter((f) => f.id !== id);
          if (st.currentFrameId === id) {
            st.currentFrameId = st.presentation.frames[0]?.id ?? null;
          }
          touch(st.presentation);
        }),

      reorderFrames: (from, to) =>
        set((st) => {
          const fr = st.presentation.frames;
          if (from < 0 || from >= fr.length || to < 0 || to >= fr.length) return;
          const [m] = fr.splice(from, 1);
          fr.splice(to, 0, m);
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
