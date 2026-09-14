# Zooming Presentation Tool — Design & Implementation Spec

A browser-based tool for building zooming, spatial presentations — drop assets onto an
infinite canvas, frame "camera shots" over them, and play or export a self-contained
HTML5 presentation. Conceptually a successor to Sozi, but without the SVG-authoring and
Inkscape round-trip: content is images, GIFs, text, and placed vector files, and the
deliverable is a single shareable `.html` file.

The guiding aim is **engaging spatial storytelling**, not slide-making. Every design
decision below is in service of "now look at *this*" being effortless.

> **Status:** This spec supersedes the original MVP design spec. Sections that changed
> from that draft are flagged with **[Revised]** and a one-line rationale, so the delta is
> auditable.

---

## 1. Scope

### In scope for MVP
- Infinite zoomable/pannable canvas ("the world").
- Placing and arranging elements: images, GIFs, SVGs, and text boxes.
- Defining frames (camera shots) by direct manipulation, not coordinate entry.
- A reorderable timeline of frames with live thumbnails.
- Per-transition timing and easing presets.
- Element entrance triggers tied to frames, with optional persist/exit behavior.
- Playback / preview with keyboard navigation and a zoom-to-overview beat.
- Speaker notes + presenter view.
- Autosave, undo/redo, smart guides/snapping.
- A few starter templates.
- Export to a single self-contained HTML5 file.

### Explicitly out of scope (deliberate non-features)
- **No drawing tools, shape libraries, or chart builders.** Place-and-frame is the
  entire identity. Users bring polished assets in. This boundary is intentional and
  should be defended against scope creep.
- **No embedded video (iframe/`<video>`) in round one.** Use GIFs for motion content.
  Video is deferred because transformed iframes misbehave under CSS transforms.
- **No SVG/vector authoring.** Vectors are *placed*, never edited.
- **No real-time multi-user collaboration** in MVP.

---

## 2. Core architecture

### 2.1 The "world" model
The canvas is a single absolutely-positioned container (the **world**) living in an
unbounded coordinate space. Elements sit at absolute coordinates inside it. The camera
is implemented as a CSS `transform` (`translate() scale() rotate()`) applied to the
world container — there is no SVG `viewBox` and no SVG coordinate math.

A **frame** is simply a saved rectangle of the world (plus rotation): the region the
camera should fill. Playback animates the world's transform from one frame's rectangle
to the next.

This is intentionally simpler than the SVG/Sozi model: "position boxes in a big space,
then save camera views over them."

**Transform convention.** The world container uses `transform-origin: 0 0` and composes
**translate then scale then rotate**. Given a viewport of size `(VW, VH)` and a target
frame rectangle `(fx, fy, fw, fh, frot)`, the camera transform is derived (not stored) —
see §2.5 for the exact fit math.

#### 2.1.1 Fit semantics — **[Revised]**
The camera **fits-to-contain (letterbox), centered** — it does *not* crop-to-fill.

*Rationale:* a frame rectangle's aspect ratio will rarely match every presenting surface
(projector, laptop, the presenter-view pane, an exported file opened on a different
monitor). Contain-fit guarantees that everything the author put inside the frame is
visible everywhere, at the cost of letterbox margins when aspect ratios differ. This makes
authored intent portable across screens, which matters most for the exported deliverable.

The effective scale is therefore `scale = min(VW / fw, VH / fh)`, with the frame centered
in the leftover axis. Letterbox color = `world.backgroundColor`.

#### 2.1.2 Camera interpolation — **[Revised]**
Camera transitions use **van Wijk & Nuij's "Smooth and Efficient Zooming and Panning"
(IEEE InfoVis 2003)**, not a naïve linear/eased interpolation of the raw transform.

*Rationale:* linearly interpolating `translate`/`scale` between two frames that are far
apart and zoomed in produces the classic artifact — the camera streaks sideways at huge
apparent velocity while barely zooming, because at high scale a small world-distance is a
huge screen-distance. The van Wijk algorithm instead zooms *out* enough to cover the gap,
translates, and zooms back *in* — the cinematic "pull back, fly over, push in" move that
is the signature feeling of zooming presentations.

**Mechanics:**
- Implement `vanWijkPath(camA, camB, rho)` returning a function `u(s) -> {cx, cy, scale}`
  for normalized path parameter `s ∈ [0, 1]`, where `(cx, cy)` is the world-space camera
  center and `scale` the zoom. `rho` (~1.4) trades path length vs. zoom amount; expose it
  internally, not in the UI.
- The algorithm also yields a natural path length, which gives **distance-aware default
  durations** (a tiny nudge between adjacent frames is quick; a cross-world leap takes
  longer) — used as the default when a frame doesn't override `duration`.
- **Motion drives the parameter, not the transform.** We animate a single scalar `s`
  from 0→1 with the frame's chosen easing/spring, and on each frame map `s` through the
  van Wijk path to compute the world transform. Motion never sees the raw matrix, so it
  can't linearize the zoom.
- **Rotation** interpolates separately and linearly (shortest-arc) across the same `s`,
  since van Wijk addresses only pan+zoom.

### 2.2 Recommended stack
- **React** — the editor is stateful (canvas, timeline, properties panel, presenter
  view); React earns its place.
- **Motion for React** (`motion`, motion.dev) — drives all camera tweens (via the scalar
  `s`, see §2.1.2) and element entrance/exit animations. Chosen for smooth, interruptible
  spring/tween animations and near-free layout/entrance effects.
  - *Note:* this is the actively maintained **Motion** library, not the legacy,
    unmaintained `react-motion` package. Any earlier mention of "react-motion" refers to
    this.
- **State + history — [Revised, newly specified]:** **Zustand + immer + zundo**.
  - Zustand for the store, immer for ergonomic immutable updates, **zundo** for
    patch-based undo/redo. Patch history is cheap and integrates cleanly with debounced
    autosave (§2.4). Threading history from day one is far easier than retrofitting it.
- **Drag/resize/rotate — [Revised: hard requirement]:** **react-rnd** (or equivalent)
  **that exposes a `scale` prop**. Drag-resize helpers compute pointer deltas in *screen*
  pixels; inside a CSS-scaled world those deltas must be divided by the current camera
  scale or handles drift when zoomed. A library without scale-awareness must not be chosen.
- Build as a static single-page app; no server required for the core editor. Vite +
  TypeScript.

### 2.3 Data model — **[Revised]**
```
Presentation {
  id, title, createdAt, updatedAt,
  world: { backgroundColor },
  elements: Element[],
  frames: Frame[],
  settings: { defaultEasing, defaultDuration }   // defaultDuration may be "auto" (distance-aware)
}

Element {
  id,
  type: "image" | "gif" | "svg" | "text",
  x, y, w, h, rotation,
  z,                          // stacking order
  content,                    // src/dataURI for media; rich text for text boxes
  maxZoom?,                   // optional soft zoom cap derived from natural pixel size (raster only)
  lifecycle: {                // [Revised] how it appears AND leaves during playback
    enterAt: frameId | null,  // null = present from the start
    enterEffect: "none" | "appear" | "fade" | "slide" | "pulse",
    enterDirection?,          // for slide
    onExit: "persist" | "leave",  // [Revised] persist (default) keeps it visible after its
                                  //  frame; "leave" removes it when navigating past
    exitAt?: frameId | null,  // optional explicit frame at/after which it leaves (with "leave")
    exitEffect?: "none" | "fade" | "slide"
  }
}

Frame {
  id,
  title,
  x, y, w, h, rotation,       // the camera rectangle over the world (fit-to-contain at play time)
  duration,                   // transition duration into this frame (ms); "auto" = distance-aware
  easing,                     // named preset -> curve/spring
  notes                       // speaker notes (markdown or plain text)
}
```

**Element lifecycle semantics — [Revised].** Modeling exit was added so persistence is a
*choice*, per request:
- Default `onExit: "persist"` — an element that has entered stays visible for the rest of
  the presentation (matches the old entrance-only behavior).
- `onExit: "leave"` — the element is removed when the camera advances past its frame (or
  past `exitAt` if set), with optional `exitEffect`.
- **Backward navigation** is symmetric and deterministic: visibility is a pure function of
  the current frame index, computed from `enterAt`/`exitAt`, so stepping backward
  re-hides/re-shows correctly with no accumulated state. Elements with `enterAt: null`
  are always present.

### 2.4 Persistence
- **Autosave** to IndexedDB on every meaningful change (debounced ~500ms). The zundo patch
  stream is a convenient autosave trigger.
- Project export/import as a `.json` file (the full presentation model + embedded asset
  data URIs) so work is portable and backup-able.
- Assets embedded as data URIs in MVP for self-containment; a later optimization can
  externalize large assets (see Open Questions).

### 2.5 Fit math (reference)
For a frame rect `F = (fx, fy, fw, fh, frot)` and viewport `(VW, VH)`:
```
scale   = min(VW / fw, VH / fh)            // contain-fit (§2.1.1)
cx, cy  = fx + fw/2, fy + fh/2             // world-space camera center
world.transform =
  translate(VW/2, VH/2)                    // viewport center
  rotate(-frot)                            // counter the frame's rotation
  scale(scale)
  translate(-cx, -cy)                      // bring camera center to origin
```
During a transition, `scale`, `(cx, cy)` come from the van Wijk path `u(s)` and `frot`
from the linear rotation interpolation, recomputed each animation frame.

---

## 3. Supported content formats

| Format | Support | Notes |
|---|---|---|
| PNG / JPG / WebP | Native | Placed as `<img>`. Blurs past natural resolution when zoomed (see `maxZoom`). |
| GIF | Native | Animates inside the world; the round-one substitute for video. |
| SVG | Native | Placed as `<img>` or inlined. Scales infinitely with no blur — ideal for zoom. Placement only, never authoring. |
| PDF | Convert-on-import (later) | Render a page to a high-res PNG via pdf.js, then place as image. Loses vector crispness; acceptable as a convenience importer, not MVP-critical. |
| EPS | Not supported | Needs server-side Ghostscript/Inkscape. Dying format; punt entirely. |

**MVP rule:** native support for PNG/JPG/WebP, GIF, and SVG. Everything else is a
"convert on import to PNG/SVG" path and can land after MVP.

**Raster zoom guidance — [Revised, from smaller notes].** Because raster assets blur once
scaled past their natural pixel resolution while SVG stays crisp, the editor computes an
optional soft `maxZoom` per raster element (from its natural size) and surfaces a subtle UI
hint when a frame zooms an element well past 1:1, so authors aren't surprised by blur in
playback/export.

---

## 4. Feature specification

Features are grouped and prioritized. The three **soul features** (marked ★) define
whether the tool feels delightful or clunky and should be built first.

### 4.1 Canvas & element handling
- Drop, paste, or file-pick to add an asset; it lands at the current view center.
- Drag to move, handles to resize, handle/modifier to rotate (via the scale-aware
  drag-resize lib, §2.2).
- **Smart guides and snapping**: alignment lines appear when an element nears another's
  edges/centers; snap on release. Cheap to add; the difference between "deliberate" and
  "sloppy" output.
- Stacking order controls (bring forward / send back).
- Text boxes are `contenteditable` with a minimal formatting set (size, weight, color,
  alignment) — enough for storytelling captions, not a word processor.

### 4.2 Framing (the camera) ★
- **★ Click-to-frame:** pan and zoom the canvas until the view looks right, press one
  button to capture it as a frame. No coordinate entry, ever. This is the core difference
  from Sozi — it should feel like a camera, not a form.
- **★ Frame-to-selection:** select one or more elements, press "frame this," and the
  camera fits to the selection (contain-fit, §2.1.1) with a sensible margin. Most
  narrative beats are "now look at this"; this makes that a single action.
- Re-capture / update a frame from the current view.
- Frames may rotate (the camera rectangle carries rotation).

### 4.3 Timeline
- Horizontal, **reorderable by drag** (storytelling is iterative; resequencing must be
  frictionless).
- **Live thumbnails per frame — [Revised: implementation pinned].** Thumbnails are a
  **scaled-down CSS clone of the world container** (same DOM, tiny `scale` transform,
  clipped to the thumb box), *not* a rasterized snapshot.
  - *Rationale:* DOM-to-canvas rasterization (html-to-image etc.) is slow and breaks on
    cross-origin images and animated GIFs. A live CSS clone updates for free, stays in
    sync, and animates GIFs naturally.
- Click a frame to jump the editor camera to it; double-click to edit title/notes.
- Add / duplicate / delete frames.

### 4.4 Transitions & pacing
- Per-transition **timing** and **easing presets** exposed as named *feels*, not curves:
  e.g. **Smooth**, **Snappy**, **Slow drift**, **Cut**. Pacing is narrative rhythm; named
  choices keep non-technical users in control of feel.
  - *Model note:* presets map to either a duration+curve or a spring. When a preset is a
    spring, the frame's `duration` is advisory/ignored; the UI hides the duration control
    for spring presets to avoid a contradictory setting.
- A project-level default that new frames inherit. `defaultDuration` may be **"auto"**
  (distance-aware, derived from the van Wijk path length, §2.1.2).

### 4.5 Element entrance & exit triggers — **[Revised]**
- An element can appear when its frame arrives rather than always being present.
- **Entrance presets** (small set): **appear**, **fade**, **slide-in**, **pulse**
  (draw-attention). Motion makes these trivial.
- **Exit is now optional and explicit:** each element chooses `persist` (default — stays
  after its frame) or `leave` (removed when navigating past its frame / `exitAt`), with an
  optional exit effect. Visibility is a pure function of frame index (§2.3), so it behaves
  correctly stepping forward and backward.
- Default is "always present, persist" so nothing is required to get started.

### 4.6 Playback & presenter experience
- Keyboard navigation: next/prev (arrows/space), jump to first/last.
- **★ Zoom-to-overview beat:** a key during playback pulls back (via the van Wijk path) to
  fit the whole world, then resumes. This spatial "here's where we are in the big picture"
  moment is the signature emotional beat of zooming presentations and is a core feature,
  not a nicety.
- **Presenter view:** a separate view showing current frame + next frame + speaker notes
  on the presenter's screen while the audience sees clean output.
  - **Sync mechanism — [Revised, newly specified]:** editor ↔ presenter ↔ audience state
    (current frame index, play/pause, overview beat) is synchronized via the
    **BroadcastChannel API**. Presenter view opens as a second window/route subscribing to
    the same channel.
- **Reduced motion — [Revised, from smaller notes]:** playback (editor and export) honors
  `prefers-reduced-motion`, substituting instant cuts for camera glides and disabling
  entrance/exit motion. Accessibility plus motion-sickness mitigation.

### 4.7 Notes
- A speaker-notes field per frame (see model). Surfaced in presenter view and editable
  from the timeline.

### 4.8 Safety & quality-of-life (unasked-for but rage-inducing if missing)
- **Autosave** (§2.4) plus **undo/redo** across all edits, implemented with Zustand +
  immer + zundo (§2.2). Losing a layout once means a user never returns.
- Smart guides/snapping (listed in §4.1).
- **Starter templates** to beat the blank-canvas problem: a small set of narrative
  skeletons — e.g. **a journey/path**, **a central hub with spokes**, **a grid** — that
  give structure and quietly teach how spatial storytelling works.

### 4.9 Performance (post-MVP guardrails)
- **Off-camera culling:** with one big world container, all elements live in the DOM.
  For large presentations, cull elements outside camera bounds + margin.
- **GIF pausing off-camera:** pause/freeze GIFs not currently near the camera (swap to a
  static first frame) to bound cost when many animate at once.
- These are deferred but called out so the world/element rendering layer is built to allow
  them (stable element bounding boxes, a culling hook).

---

## 5. Export (HTML5 deliverable) — **[Revised]**
- Serialize elements + frames to JSON and emit a **single self-contained `.html`** file:
  static world markup + embedded assets (data URIs) + a small runtime.
- The runtime reads the frames and animates the world transform on click / arrow keys,
  including the **van Wijk camera path**, the overview beat, and element entrance/exit
  effects. It must reproduce **contain-fit** (§2.1.1) so the deliverable looks identical
  to the editor across screen aspect ratios.
- **Motion is inlined by default — [Revised].** The runtime inlines Motion (~small) so the
  file plays fully offline. CDN-loading is an opt-in size optimization only, never the
  default, because the product promise is a single shareable file.
- **Font portability — [Revised].** Export commits to one of:
  (a) restrict text to a system-font stack, or (b) embed used fonts as data URIs (subset
  to used glyphs where feasible). Default: system-font stack in MVP; font embedding is the
  first post-MVP fidelity upgrade. This resolves the editor-vs-export text drift.
- **Reduced motion** is honored in the exported runtime (§4.6).
- Output is one shareable file — the spiritual equivalent of Sozi's `.sozi.html` — with no
  dependency on the editor to play.

---

## 6. Build priority (suggested MVP path) — **[Revised]**

1. **Core loop first:** world container + a draggable element + click-to-frame +
   Motion-driven playback between two frames **using the van Wijk pan-zoom path and
   contain-fit from day one**. This smallest slice answers "does the core feel right?" —
   and because the camera feel *is* the product, the interpolation can't be a later
   polish pass.
2. Add the three soul features fully: ★ click-to-frame, ★ frame-to-selection,
   ★ zoom-to-overview beat.
3. Element types (image/GIF/SVG/text) + scale-aware resize/rotate + snapping.
4. Timeline with reorder + CSS-clone thumbnails.
5. Transition presets + entrance/exit triggers.
6. Notes + presenter view (BroadcastChannel sync).
7. Autosave + undo/redo (Zustand + immer + zundo) — **thread through from step 1**, easier
   than retrofitting.
8. Templates.
9. HTML5 export (inline Motion, contain-fit runtime, system fonts, reduced-motion).
10. (Post-MVP) Font embedding; off-camera culling + GIF pausing; PDF import-to-raster;
    later, video.

---

## 7. Open questions to resolve during build
- Asset embedding strategy at scale (data URIs bloat the project file and export; decide
  when to externalize).
- Coordinate precision / max practical zoom range before sub-pixel artifacts appear (also
  informs per-element `maxZoom`).
- GIF performance when many animate at once in a large world (pausing off-camera GIFs,
  §4.9).
- Text rendering fidelity in export vs. editor (system fonts vs. font embedding, §5).
- van Wijk `rho` default and whether per-transition overrides are ever worth exposing.

---

## Appendix A — Summary of revisions from the original MVP spec

| # | Change | Section |
|---|--------|---------|
| 1 | Confirm **Motion for React** (motion.dev), not legacy `react-motion` | §2.2 |
| 2 | Camera transitions use **van Wijk & Nuij smooth pan-zoom**; Motion drives a scalar parameter, not the raw transform; distance-aware default durations | §2.1.2, §2.5, §4.4, §6 |
| 3 | Explicit **contain-fit (letterbox), centered** camera semantics | §2.1.1, §2.5 |
| 4 | **State + undo/redo pinned:** Zustand + immer + zundo | §2.2, §4.8 |
| 5 | Drag-resize lib **must expose a `scale` prop** (hard requirement) | §2.2 |
| 6 | **Element exit is optional**: `persist` (default) vs `leave`; visibility is a pure function of frame index; symmetric backward nav | §2.3, §4.5 |
| 7 | **Thumbnails are CSS clones**, not rasterized snapshots | §4.3 |
| 8 | **Presenter sync via BroadcastChannel** | §4.6 |
| 9 | **prefers-reduced-motion** honored in editor and export | §4.6, §5 |
| 10 | Export **inlines Motion by default**; font strategy committed (system fonts → embedding) | §5 |
| 11 | **Raster `maxZoom` hint** to warn about blur under zoom | §3, §2.3 |
| 12 | **Performance guardrails** (off-camera culling, GIF pausing) called out for the render layer | §4.9 |
