# pres-sure — User Manual

**pres-sure** is a browser-based tool for building *zooming, spatial presentations*. Instead
of slides, you arrange images, GIFs, SVGs and text on one infinite canvas (the **world**),
then frame "camera shots" over them. Playback glides the camera from shot to shot with a
cinematic zoom — the feeling that made Prezi and Sozi memorable — and you can export the
whole thing as a single, self-contained `.html` file that plays anywhere, offline.

This manual covers everything in the current build.

---

## 1. Getting started

### Running the app
```bash
npm install
npm run dev      # opens the editor at http://localhost:5173
```
Other scripts: `npm run build` (production bundle), `npm run preview` (serve the build),
`npm run typecheck`.

### First launch
On first open you'll see the **Start a presentation** dialog with four choices:

| Choice | What you get |
|---|---|
| **Journey / path** | A left-to-right sequence of beats. Good for stories and timelines. |
| **Hub & spokes** | A central idea with four surrounding details. Showcases the overview beat. |
| **Grid** | A 3×2 grid of cells for methodical, catalog-style walkthroughs. |
| **Blank canvas** | An empty world to build from scratch. |

Your work **autosaves continuously** to the browser (IndexedDB). Next time you open the app
it restores automatically — the start dialog only appears when there's nothing saved.

---

## 2. The editor at a glance

```
┌──────────────────────────────────────────────────────────┐
│ Toolbar:  title · add · undo/redo · import/export · present│
├───────────────────────────────────┬────────────────────────┤
│                                   │  Properties             │
│        Canvas (the world)         │  (selected element OR   │
│                                   │   current frame + world)│
├───────────────────────────────────┤                        │
│  Timeline: frames + thumbnails     │                        │
└───────────────────────────────────┴────────────────────────┘
```

- **Canvas** — your infinite world. Pan, zoom, place and arrange elements here.
- **Timeline** (bottom) — the ordered list of camera shots ("frames"), with live thumbnails.
- **Properties** (right) — context panel: edits the selected element, or the current frame
  plus world settings when nothing is selected.

---

## 3. Working on the canvas

### Navigating the world
- **Zoom:** mouse wheel / trackpad scroll. Zoom centers on the cursor.
- **Pan:** click-and-drag on empty canvas.
- Zoom range is large but finite; raster images blur once enlarged past their native
  resolution (SVGs and text stay crisp at any zoom — see §7).

### Adding content
From the toolbar:
- **+ Text** — drops an editable text box at the current view center.
- **+ Image / GIF / SVG** — file picker (PNG, JPG, WebP, GIF, SVG). You can select several
  at once. Assets are embedded into the project, so everything stays self-contained.

### Selecting & arranging
- **Click** an element to select it (it shows a blue outline and resize handles).
- **Drag** to move; drag a corner/edge **handle** to resize.
- **Smart guides:** as you drag near another element's edges or centers, alignment lines
  appear and the element **snaps** into line when you release.
- **Rotation & precise size/position:** use the Properties panel (X, Y, W, H, Rotation°).
- **Stacking:** *Bring forward* / *Send back* in Properties.
- **Editing text:** with a text box selected, click into it to type. Set size, weight,
  color and alignment in Properties.
- **Delete:** select and press <kbd>Delete</kbd> / <kbd>Backspace</kbd>, or use the
  *Delete element* button.

---

## 4. Framing — the heart of the tool

A **frame** is a saved camera shot: a rectangle of the world the camera will fill. There is
no coordinate entry — you compose shots like a camera.

Two ways to create a frame (both in the Timeline header):

1. **+ Frame from view** — pan and zoom until the canvas looks exactly how you want the
   audience to see it, then click. The current view becomes a frame.
2. **+ Frame selection** — select one or more elements and click. The camera fits neatly
   around them with a margin. This is the fastest way to say "now look at *this*."

Working with frames in the **Timeline**:
- **Click** a frame to glide the editor camera to it (a preview of the real transition).
- **Drag** frames to **reorder** them — sequence is everything in storytelling.
- **Title** field — rename inline.
- **Dup** — duplicate a frame; **Del** — delete it.
- **Re-capture from current view** (Properties) — update a frame to match where you are now.

Frames can be rotated (the camera rectangle carries rotation), so you can build tilted or
dramatic reveals.

> **Fit behavior:** the camera always *fits-to-contain* a frame (letterboxing if the screen
> aspect ratio differs), so your exported file looks the same on any monitor or projector.

---

## 5. Transitions & pacing

Select a frame (click it, then look at Properties) to set how the camera moves *into* it:

- **Transition feel:**
  - **Smooth** — balanced cinematic glide (default).
  - **Snappy** — a quick spring. (Duration is governed by the spring, so the duration
    control is hidden.)
  - **Slow drift** — a languid, deliberate move.
  - **Cut** — instant, no animation.
- **Duration:** leave on **auto** (distance-aware — short hops are quick, cross-world leaps
  take longer) or untick to set an exact millisecond value.

All camera moves use a smooth zoom-and-pan path (van Wijk's algorithm): when two frames are
far apart, the camera gracefully zooms *out*, travels, and zooms back *in*, instead of
streaking sideways. This is what makes large jumps feel intentional.

---

## 6. Element entrance & exit

By default every element is present the whole time. You can make elements appear and
disappear as the story progresses. With an element selected, open the **Lifecycle** section
of Properties:

- **Enters at** — *From start* (always present) or a specific frame.
- **Entrance effect** — `none`, `appear`, `fade`, `slide` (choose a direction), or `pulse`
  (a draw-attention beat).
- **On exit:**
  - **Persist** (default) — once it appears, it stays for the rest of the show.
  - **Leave** — it's removed when you navigate past its frame. Choose **Leaves after**
    (which frame) and an **Exit effect** (`fade`/`slide`/`none`).

Visibility is fully deterministic: stepping **backward** re-hides or re-shows elements
correctly, so you can rehearse in any direction.

---

## 7. Presenting

Click **▶ Present** (top-right) to enter full-screen playback.

**Navigation keys:**

| Key | Action |
|---|---|
| <kbd>→</kbd> / <kbd>Space</kbd> / <kbd>PageDown</kbd> | Next frame |
| <kbd>←</kbd> / <kbd>PageUp</kbd> | Previous frame |
| <kbd>Home</kbd> | First frame |
| <kbd>End</kbd> | Last frame |
| <kbd>O</kbd> | **Overview beat** — pull back to see the whole world, then resume |
| <kbd>Esc</kbd> | Exit playback |

A faint control bar at the bottom (hover to reveal) offers the same actions, and a progress
bar runs along the top.

**The overview beat** (<kbd>O</kbd>) is the signature move of spatial presentations: it zooms
all the way out to show where you are in the big picture, then the next navigation returns
you to the flow. Use it to re-orient your audience.

### Presenter view
Click **Presenter** to open a second window showing the **current frame**, the **next
frame**, your **speaker notes**, and an elapsed-time clock — while the audience screen stays
clean. The two windows stay in sync automatically (via the browser's BroadcastChannel), so
advancing on the audience screen updates the presenter screen. Put speaker notes on each
frame using the **Speaker notes** field in Properties.

> Tip: open the presentation window on the projector, the Presenter window on your laptop.

### Reduced motion
If your operating system has "reduce motion" enabled, all glides become instant cuts —
in both the editor preview and exported files.

---

## 8. Saving, exporting & importing

All in the toolbar:

- **Autosave** — automatic and continuous to this browser. No action needed.
- **Save .json** — download the full project (model + embedded assets) for backup or to move
  between machines.
- **Import** — load a previously saved `.json`, replacing the current project.
- **Export .html** — produce a **single self-contained `.html`** file: static content +
  embedded assets + a small built-in player. It plays in any modern browser with **no
  internet and no dependency on this editor** — the shareable deliverable. Text uses a
  system-font stack for portability.

The exported file responds to the same navigation keys (arrows/space, <kbd>O</kbd> for
overview), clicking to advance, and honors reduced-motion settings.

---

## 9. Undo, redo & safety

- **Undo:** <kbd>Ctrl/⌘ + Z</kbd> · **Redo:** <kbd>Ctrl/⌘ + Shift + Z</kbd> (or
  <kbd>Ctrl + Y</kbd>). Also available as toolbar buttons. History covers all content and
  frame edits (up to 100 steps).
- **Autosave** means a crash or refresh won't lose your layout.
- Camera position, selection and play state are intentionally *not* part of undo history —
  undo only affects your actual content.

---

## 10. Keyboard shortcut reference

**Editor**

| Key | Action |
|---|---|
| <kbd>Ctrl/⌘ + Z</kbd> | Undo |
| <kbd>Ctrl/⌘ + Shift + Z</kbd> / <kbd>Ctrl + Y</kbd> | Redo |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selected element |
| <kbd>Esc</kbd> | Deselect |
| Mouse wheel | Zoom (to cursor) |
| Drag empty canvas | Pan |

**Playback** — see §7.

---

## 11. Tips & limits

- **Bring polished assets.** pres-sure places and frames content; it deliberately has no
  drawing tools, shape libraries or chart builders. Design visuals elsewhere, import them
  here.
- **Use SVG for anything you'll zoom into hard** — it stays razor-sharp at any zoom. A blur
  warning appears on raster images enlarged past their native resolution.
- **Motion content:** use **GIFs** (embedded video is not supported in this round).
- **Big jumps feel best with the overview beat** — pull back, then dive into the next region.
- **Not yet supported:** embedded video, PDF/EPS import, real-time multi-user collaboration,
  and SVG/vector editing. These are out of scope by design or deferred.

---

*For the architecture and rationale behind these features, see
[`design-and-implementation-spec.md`](./design-and-implementation-spec.md).*
