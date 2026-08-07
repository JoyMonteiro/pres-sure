# Hold Frames & Sequential Reveals — Design Doc

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning

## 1. Problem

Sometimes a presenter wants things to appear one after another in place — bullet points,
a sequence of images — without the camera moving. pres-sure today has no unit of advance
other than the frame: every ↓/→ advances `index` by one (`Player.tsx`), and every
element's entrance is keyed to a frame id via `lifecycle.enterAt` (`types.ts`).

The reveal is therefore expressible today, but only by duplicating a frame N times with an
identical camera rect and setting each copy's easing to `cut`. That works — and the
degenerate van Wijk branch plus `timingFor`'s cut short-circuit make it visually correct —
but it costs a wall of near-identical thumbnails in the timeline, splits speaker notes
across copies, and lets the copies silently drift out of alignment when the original shot
is re-captured.

The data model is adequate. The authoring experience is not.

## 2. What we are building

1. **Hold frames** — a frame that borrows the preceding shot's camera instead of carrying
   its own, renders in the timeline as a thin tick rather than a full card, and advances
   instantly.
2. **Multi-select** — shift/meta-click to select several elements, in click order.
3. **"Reveal one at a time"** — an action that turns a multi-selection into a build:
   one hold per element after the first, with `enterAt` wired up.

## 3. Decisions

### D1 — Reveal only. No dimming or emphasis.

A step brings the next element(s) in; everything already visible stays exactly as it is.
This is entirely expressible with the existing `enterAt` model, so `visibility.ts`,
`stagger.ts` and the export runtime's `visAt` are untouched. A "dim the previous bullets"
build would need a third visual state beyond visible/hidden, mirrored into the runtime;
it is deliberately excluded.

### D2 — Holds live-link to their shot; they do not copy its rect.

A hold has no meaningful camera of its own. At play time it resolves to the nearest
preceding shot. Re-capture the shot and the entire build follows it. The alternative —
copying the rect at creation — reintroduces exactly the drift bug the feature exists to
prevent, and the "copy but auto-sync on every mutation" variant maintains the invariant by
diligence at each mutation site rather than by construction.

### D3 — Positional flag (`kind`), not a parent link or nesting. *(Approach A1)*

`Frame` gains an optional `kind?: "shot" | "hold"`. Resolution walks backwards to the
nearest preceding shot. Two alternatives were considered and rejected:

- **Explicit `holdOf: <shot id>`** — the link survives a careless drag, but then a hold can
  sit where its parent isn't, and it introduces a second, contradictory notion of "which
  frame governs this one" alongside the positional, sticky rule already committed to in
  §4.2 of `docs/animation-enhancements-design.md`.
- **`Frame.holds: HoldStep[]` (nesting)** — makes orphans structurally impossible, but
  destroys the flat frame index that `visibilityAt`, `enterOrder`, `Player`,
  `PresenterView`, `enterAt` and the export runtime all depend on. Every index becomes a
  `(frame, step)` pair. The one guarantee it buys is enforceable far more cheaply as a
  clamp in the reorder action.

`kind` being optional and absent-means-shot keeps every existing IndexedDB save, exported
JSON and template loading unchanged. No migration, no schema version.

### D4 — Export resolves holds at build time; `runtime.ts` is not modified.

`buildHtml` serializes the whole presentation with a single `JSON.stringify(p)`
(`exportHtml.ts`). Passing the frames through one pure `flattenFrames()` first — hold rects
resolved, easing forced to `cut`, `kind` stripped — means the exported runtime receives
ordinary frames and its `visAt` / `go` / `path` code is untouched. The dependency-free
export guarantee is never even brought into question.

### D5 — Build order is click order, made visible.

Elements sequence in the order they were shift-clicked. This deliberately differs from the
same-frame stagger in `stagger.ts`, which ripples by `z` — the two answer different
questions, and reading-order (`y`) sorting was rejected because it silently overrides an
author who wants a non-obvious reveal order.

Click order is load-bearing but invisible by default, so it is made visible: when 2+
elements are selected, each carries an ordinal badge (1, 2, 3…) on the canvas.

### D6 — Every step counts in the progress bar and presenter view.

Progress reflects clicks remaining, which is what a presenter wants mid-talk. Both already
derive from the frame index, so this requires no change. Counting shots only would need a
separate index everywhere progress is computed, and would leave the bar frozen during a
build.

### D7 — One element per bullet. No per-line reveal inside a text box.

A text element holds a single HTML string (`types.ts`). A five-bullet build is five text
elements. Targeting a line index inside one text box would make lifecycle no longer
per-element, breaking the `enterAt` model shared by visibility, stagger and the runtime —
the same blast radius rejected in D3.

### D8 — This lands before the outstanding motion-enhancements tasks.

`docs/superpowers/plans/2026-07-02-motion-animation-enhancements.md` has Tasks 4–11
outstanding, and its Task 8 rewrites `Timeline.tsx` to animate reordering with View
Transitions — the same file this feature restructures. Holds land first; the outstanding
motion tasks are re-checked against the new timeline afterwards. Adding a view transition
to a settled timeline is easier than restructuring one that was just animated.

## 4. Data model

```ts
export type FrameKind = "shot" | "hold";

export interface Frame {
  // …unchanged…
  /** "hold" = a reveal step borrowing the preceding shot's camera. Absent = "shot". */
  kind?: FrameKind;
}
```

`makeHold()` joins `makeFrame()` in `store/factory.ts`, fixing `kind: "hold"`,
`easing: "cut"`, `duration: 0`. A hold's own `x/y/w/h/rotation` are never read.

## 5. Components

### `src/playback/holds.ts` (new, pure)

Sits alongside `visibility.ts` and `stagger.ts` — the same kind of thing, a fact derived
purely from frame order. `planReveal` is the authoring inverse: it computes the frame order
that produces a given build, so it belongs with the functions that read that order back.

| Function | Purpose |
|---|---|
| `isHold(f)` | `f.kind === "hold"` |
| `resolveFrameRect(frames, i)` | Effective `{x,y,w,h,rotation}`; walks back to the nearest preceding shot |
| `flattenFrames(frames)` | Whole list with holds resolved, easing forced to `cut`, `kind` stripped — the single export transform |
| `holdGroups(frames)` | `{ shot, holds[], startIndex }[]` — used by the timeline |
| `planReveal(frames, elementIds, currentFrameId)` | Holds to insert + `enterAt` assignments |

A hold at index 0 has no preceding shot; `resolveFrameRect` falls back to the first shot in
the list. `moveFrameGroup` prevents a hold from preceding every shot, so the fallback
should not fire in practice.

### Store (`store/store.ts`)

- `toggleSelect(id)` — transient; appends on add so click order is preserved.
- `revealOneAtATime()` — applies `planReveal` in a single `set()`, so it is one undo entry.
- `addHoldStep(shotId)` — bare hold at the end of a shot's group.
- `moveFrameGroup(from, to)` — replaces `reorderFrames`, which is only called from
  `Timeline.tsx` and leaves no orphaned API behind.
- `removeFrame` — deleting a shot deletes its holds; deleting a hold reassigns its
  elements' `enterAt` to the preceding frame.

### `revealOneAtATime` semantics

Given `selectedIds` in click order and a `currentFrameId`. The **anchor** is the frame
`currentFrameId` names, whether it is a shot or a hold; its **group** is the shot it
resolves to plus that shot's holds.

1. Element 1 is assigned to the **anchor itself** — arriving there reveals the first
   bullet, so N bullets cost N−1 new steps.
2. N−1 holds are inserted immediately after the end of the anchor's group, titled
   "Step 2"…"Step N". Numbering restarts per build and is cosmetic; nothing reads it.
3. Each remaining element's `enterAt` points at its hold.
4. `enterEffect` is upgraded from `"none"` to `"fade"` — and **only** from `"none"`, so a
   deliberate choice is never overwritten. Without this the reveal is a hard pop, since
   `entering` only fires for a non-null `enterAt` (`visibility.ts`).

If a selected element already has an `enterAt`, the action overwrites it. The action is
explicit, so this is intended.

### Editor UI

- **`ElementView.tsx`** — `onMouseDown` gains a shift/meta branch calling `toggleSelect`;
  unmodified click still replaces the selection. Ordinal badge when 2+ are selected.
- **`PropertiesPanel.tsx`** — currently forks two ways (one element, or the frame); gains a
  third branch for 2+ selected, holding the build action. For a hold, `FrameProps` hides
  the transition-feel and duration controls (meaningless without a camera move) and
  replaces "Re-capture from current view" with a line naming the shot it inherits from.
- **`Timeline.tsx`** — renders via `holdGroups`. A `.frame-group` wrapper holds the
  existing `.frame-card` plus its ticks; a tick is ~16px wide, full card height, shows its
  step ordinal, takes `current` styling when active, and carries a small delete. Clicking a
  tick sets `currentFrameId` without moving the camera. The shot card remains the drag
  handle and moves the whole group. Ticks are not draggable in v1. A "+ Step" button per
  shot adds a bare hold.

### Playback and export

- `Player.tsx` and `Timeline.tsx` route `frameToCamera` through `resolveFrameRect`.
  Advancing into a hold is instant with zero camera motion; the entering element plays its
  Motion entrance. Stepping backwards stays symmetric because `visibilityAt` depends only
  on the index. The overview beat is unchanged.
- `PresenterView.tsx` needs no change: its next-up pane already renders `Stage` at
  `index + 1`, which for a hold shows the same camera with the next reveal visible.
- `exportHtml.ts` serializes `{ ...p, frames: flattenFrames(p.frames) }` instead of `p`.

## 6. Data flow

```
shift-click ──> toggleSelect ──> selectedIds (ordered)
                                      │
                            revealOneAtATime
                                      │
                             planReveal (pure)
                                      │
                        frames[] + elements[].lifecycle
                           │                    │
                  holdGroups (timeline)   visibilityAt (unchanged)
                           │                    │
                  resolveFrameRect ──────> Player camera
                           │
                  flattenFrames ─────────> runtime.ts (unchanged)
```

## 7. Error and edge cases

| Case | Behaviour |
|---|---|
| Hold at index 0 | Resolver falls back to the first shot; `moveFrameGroup` prevents creating the situation |
| `revealOneAtATime` with no current frame | Action disabled in the UI |
| `revealOneAtATime` with <2 selected | Action not shown (the panel's third branch requires 2+) |
| Delete a shot | Its holds are deleted with it |
| Delete a hold | Its elements' `enterAt` moves to the preceding frame |
| Element already has `enterAt` | Overwritten; the action is explicit |
| Reduced motion | Unchanged — `timingFor` already collapses everything to a cut |

## 8. Testing

All new logic is pure, so it tests without jsdom (`npm test` is `vitest run`, no DOM env).

- **`holds.test.ts`** — resolver across a single hold, consecutive holds, a hold at index 0
  (fallback), and a hold under a rotated shot (rotation carries); `holdGroups` shape.
- **`planReveal`** — N elements produce N−1 holds; element 1 lands on the current shot;
  click order preserved; `none` upgrades to `fade` while an explicit effect survives.
- **`flattenFrames`** — no `kind` survives; hold rects equal their shot's; holds all cut.
- **`visibility.test.ts` and `stagger.test.ts` must pass unmodified** — that is the evidence
  the playback model did not shift.

Manual verification: build a 4-bullet list, play it, confirm no camera motion between
steps, step backwards through it, then re-capture the parent shot and confirm the whole
build follows.

## 9. Out of scope

- Dimming or emphasis of already-revealed elements (D1).
- The `(frame, step)` sub-step model (D3).
- Per-line reveal inside a text element (D7).
- Tick drag-reorder within a group.
- Per-hold camera nudges.
- **Dangling `enterAt` on frame deletion** — deleting any frame today leaves dangling ids,
  and `visibilityAt` treats a dangling id as "visible from the start, no entrance". This is
  pre-existing and orthogonal; this work only handles the hold-deletion case it introduces.
