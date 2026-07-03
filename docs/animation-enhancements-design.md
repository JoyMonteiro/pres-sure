# Animation Enhancements — Design Doc

**Status:** Approved for implementation (see `docs/superpowers/plans/2026-07-02-motion-animation-enhancements.md`)
**Date:** 2026-07-02
**Context:** Motion released `animateView()` (a wrapper over the browser View Transitions API) into its free core library — see https://motion.dev/magazine/a-view-transitions-api-for-the-rest-of-us. This doc decides what, if anything, pres-sure should adopt from it, and specifies a small set of animation improvements.

---

## 1. Current animation architecture (three layers)

1. **Camera flight** — `src/playback/engine.ts`. Motion's `animate()` drives a scalar 0→1 that is mapped through the van Wijk zoom-pan path (`src/camera/vanwijk.ts`). Motion never sees the raw transform, so it cannot linearize the zoom. Easing presets live in `src/camera/easing.ts`.
2. **Element lifecycle effects** — `src/components/ElementView.tsx` (`PlaybackElement` + `variantsFor`) using `motion/react` variants, gated by the pure function `visibilityAt` in `src/playback/visibility.ts`. Effects today: `none | appear | fade | slide | pulse` on enter; `none | fade | slide` on exit.
3. **Export runtime** — `src/export/runtime.ts` re-implements layers 1–2 in dependency-free vanilla JS (rAF camera loop + WAAPI `node.animate`) so exported `.html` files play fully offline.

## 2. Decisions

### D1 — The camera stays on the van Wijk path. View Transitions rejected for camera moves.
View Transitions rasterize snapshots of the old/new DOM states and morph the bitmaps. For a zooming canvas this is strictly worse than what we have: the continuous flight through space is lost and deep zooms blur (you'd be scaling a screenshot). **No change to `engine.ts` / `vanwijk.ts` / `easing.ts` camera code.**

### D2 — Automatic staggered group entrances (no new UI).
When several elements enter at the same frame, their entrance effects currently fire simultaneously. We stagger them 60 ms apart, ordered back-to-front by `z`. This is a better default, not a knob: zero schema change, zero new UI, and every existing presentation with multi-element entrances immediately looks more designed. Deterministic ordering lives in a shared pure function (`src/playback/stagger.ts`) mirrored in the export runtime, same pattern as `visibility.ts`.

### D3 — One new entrance effect: `spring` (a scale-up pop with bounce).
Rather than a grid of new effects, we add a single well-tuned springy entrance (`opacity 0→1`, `scale 0.6→1`, underdamped spring, stiffness 260 / damping 18).

**Export parity without bundling Motion:** the exported runtime cannot run Motion springs, and hand-rolling a spring integrator in the runtime string is fragile. Instead we sample the closed-form damped-spring curve at export **build time** (TypeScript, unit-testable) and emit a CSS `linear()` easing string + duration that WAAPI plays back natively. Browsers without `linear()` support fall back to `ease-out` via `CSS.supports` detection. This keeps the export's "dependency-free, plays offline" guarantee intact.

### D4 — `animateView()` for editor chrome only (timeline), as progressive enhancement.
The classic View Transitions win is list reordering, and the frame strip in `src/components/Timeline.tsx` is exactly that. Frame reorder/duplicate/delete get wrapped in `animateView(() => flushSync(mutate)).add(".frame-card")` so thumbnails glide to their new slots. Requires upgrading `motion` 11 → 12 (where `animateView` shipped in free core). Feature-detected on `document.startViewTransition`; unsupported browsers and `prefers-reduced-motion` users keep today's instant behavior. **Never used in the export runtime**, so audience browser support is irrelevant.

### D5 — Reduced motion is preserved everywhere.
Every addition must collapse under `prefers-reduced-motion: reduce` exactly as today: camera cuts, no element effects, no view transitions.

### D6 — Properties panel selection swap gets a crossfade — via `AnimatePresence`, not View Transitions.
`src/components/PropertiesPanel.tsx:19` hard-swaps `<ElementProps>` ↔ `<FrameProps>` whenever the selection category changes. This *reads* as a View Transitions use case, but it isn't: the swap is driven by `select()`, which fires on **every canvas click** — a whole-page `startViewTransition` snapshot per click is the wrong tool for high-frequency direct manipulation. `AnimatePresence` (already used in `src/components/Stage.tsx:30`) scopes the crossfade to just the panel subtree, keyed on the branch (`"element"` vs `"frame"`), with no page snapshot and no coexistence risk. So D6 ships as a Motion `AnimatePresence` crossfade. (Recorded here because the review first proposed VT for it; grounding in the code changed the tool, not the outcome.)

### D7 — Mode transition (edit ↔ present) gets a whole-page crossfade.
Entering/leaving the presentation currently hard-swaps the entire app shell (`src/App.tsx:62` renders `<Player>` when `mode === "play"`). Wrapping the `setMode` call sites (Toolbar's Present button, the Player's Exit button + Escape handler) in a default (un-scoped, whole-page) view transition crossfades the shells.

**The camera-conflict caveat is smaller than it first appears:** entering play mode performs an *instant* initial landing — `src/components/Player.tsx:84` calls `apply()` (a direct set), not an animated `moveTo()`. So the crossfade lands on frame 0 statically; the first van Wijk *flight* only happens on the next navigation, after the transition has finished. Exiting to edit mode is likewise static. The overlap risk is therefore low, but the executor must still verify no double-motion on entry (D8 governs this).

### D8 — View-transition coexistence rules.
`document.startViewTransition` snapshots the **whole page** by default, and view transitions cannot safely overlap each other or a running Motion animation (the snapshot freezes, then crossfades, producing a snap if something is mid-flight). With D4/D6/D7 there are now three VT entry points plus the Motion camera/element engine. Rules, binding on all VT usage:

1. Never wrap a state change that *also* starts a Motion camera or element flight. (This is exactly why D7 is safe only because its landing is instant.)
2. Keep VT entry points on distinct, non-animating chrome so two transitions can't be requested in the same tick.
3. View transitions are **editor-only**. The export runtime never uses them (it would rasterize during camera transforms and blur deep zooms — the same reason D1 keeps the camera off View Transitions).

## 3. Explicitly out of scope / considered and declined

- **Hover/live preview of entrance effects in the Properties panel** — replay the selected effect on the canvas element when hovering an option. High UX value, but needs ephemeral preview state plumbed through the edit canvas; separate piece of work.
- **Staggered exits** — symmetric to D2; deferred until someone asks.
- **User-tunable stagger step** — deliberately not a setting for now (D2 is a default, not a feature).
- **View transitions on edit-canvas element add / delete / z-reorder** (`src/components/EditCanvas.tsx:87`, `bringForward`/`sendBackward`) — *considered, declined for VT.* These elements live inside a live camera-transformed world and are wrapped in `react-rnd`; a VT snapshot mid-transform is fragile, and a full-canvas crossfade on every delete would slow the direct-manipulation feel. If we ever want motion here, `AnimatePresence` (already used in `src/components/Stage.tsx:30`) is the cheaper, safer tool.
- **Presenter "Next" → "Current" shared-element morph** (`src/components/PresenterView.tsx`) — *considered, deferred.* Advancing swaps two static preview panes; pairing them with `animateView(...).add(oldNext, newCurrent)` would slide the next-slide preview into the current slot. It's the one place the shared-element *pairing* API would shine outside Magic Move, but it's niche polish. Recorded so it isn't re-discovered; not scheduled.

**Note:** The "Magic Move" content-morph step used to live here as out-of-scope. It has been promoted to a full Phase 2 design — see §4. It is still speculative and may not ship; it lives in the plan (Tasks 12–15) so the design is captured either way.

## 4. Magic Move / content morph (Phase 2 — speculative)

This is the genuinely new capability View Transitions unlock, and the one worth designing even if we don't build it yet. Keynote calls it Magic Move; Sozi and Prezi both lack it. Today the only way "content changes" in pres-sure is stacking two elements with complementary enter/exit lifecycles — there is no way to say "this element becomes *this* at frame 3."

### 4.1 Data model — per-frame element overrides
Add an optional overrides map to `Frame` in `src/types.ts`:

```ts
export interface ElementOverride {
  x?: number; y?: number; w?: number; h?: number; rotation?: number;
  content?: string;                 // text HTML or media src
  textStyle?: Partial<TextStyle>;
}
export interface Frame {
  /* …existing fields… */
  /** elementId → override applied from this frame onward (sticky, like lifecycle). */
  overrides?: Record<string, ElementOverride>;
}
```

### 4.2 Resolution semantics — sticky, deterministic, pure
An element's *effective* properties at frame index `i` = the base element merged with the override from the **most recent frame at or before `i`** that overrides it. Sticky (carries forward) mirrors the lifecycle "persist" model, and — critically — stays deterministic when stepping backward, exactly like `visibilityAt`. This lives in a pure, unit-tested function `resolveElementAt(el, frames, i): Element`, mirrored in the export runtime (same pattern as `visibility.ts` / `stagger.ts`).

### 4.3 The core tension — snapshot morph vs. continuous camera flight
A view transition freezes a before/after snapshot and crossfades it. The van Wijk engine wants to *continuously* fly the camera. If a frame both moves the camera a long way **and** morphs an element, the two motions compete and the morph will visibly snap. Resolution:

- **Geometry morph** (x/y/w/h/rotation): do NOT use view transitions. Interpolate the effective properties directly — Motion in the editor, WAAPI in the export. This composes cleanly with a simultaneous camera flight (both are just transforms) and keeps export parity for free.
- **Content morph** (text ↔ different text, image ↔ image): a crossfade is what you actually want, and property interpolation can't crossfade arbitrary content. Use `animateView` in the **editor**; in the **export**, stack the old and new nodes and opacity-crossfade them with WAAPI (no VT, no Motion — dependency-free per D8.3).
- **When a large flight and a morph coincide:** sequence them — let the camera flight finish, *then* run the morph on arrival. Simpler to reason about than co-timing, and avoids the snap entirely.

### 4.4 Export strategy
Because geometry uses WAAPI interpolation and content uses a WAAPI opacity crossfade, the exported file needs **no** View Transitions API and **no** Motion — the D8.3 / global "dependency-free export" guarantee holds. `animateView` is used only in the editor, purely as authoring-time polish; the exported playback is the source of truth and reproduces the same morph via interpolation + crossfade.

### 4.5 Known gap — geometry authoring has no UI
The data model and playback support geometry overrides (x/y/w/h/rotation), and they morph correctly at play time. But there is **no way to author them by direct manipulation**: the edit canvas (`src/components/EditCanvas.tsx`) always renders each element's *base* state, so you cannot "go to frame 3, drag the box to its new spot, and have that become the override." Authoring geometry the natural way requires the edit canvas to render the current frame's *resolved* state (via `resolveElementAt`) and to write drags/resizes back as overrides on the current frame — a non-trivial editor change entangled with the existing base-state editing and `react-rnd` wiring.

Consequently the MVP (plan Task 13) authors **text-content overrides only**. Geometry overrides can be set programmatically or via imported JSON and will morph in playback, but have no editor affordance. Closing this gap is the main follow-on work if Magic Move proves worth keeping; it is deliberately not scheduled in this plan. This is the single biggest limitation of the Magic Move design as specified.

### 4.6 Status
Phase 2, speculative. Tasks 12–15 in the plan flesh it out at full rigor so the decision to build (or not) can be made against a concrete design rather than a hand-wave. If we ship Phase 1 (Tasks 1–11) and it lands well, revisit — starting with the §4.5 geometry-authoring gap.

## 5. Risks

| Risk | Mitigation |
|---|---|
| `motion` v11→12 upgrade breaks editor animation | Upgrade is an isolated task late in the plan; Tasks for D2/D3 use only v11-compatible APIs. Typecheck + manual playback smoke test gate the upgrade commit. |
| `animateView` builder API differs from the article | **Verified 2026-07-02:** motion-dom@12.42.2 (re-exported by motion@12.42.2 via framer-motion/dom) types `animateView(update, options?): ViewTransitionBuilder` with `.add(subject): this`. Raw fallback `document.startViewTransition(() => flushSync(mutate))` documented in the plan regardless. |
| CSS `linear()` unsupported in an audience browser | `CSS.supports` check in the runtime; falls back to `ease-out` tween. |
| WAAPI `delay` flashes the element before a staggered animation starts | All entrance animations use `fill: 'backwards'`. |
| Multiple VT entry points (timeline, panel, mode) snap when overlapping, or fight a Motion flight | D8 coexistence rules: VTs only on distinct non-animating chrome, never wrapping a state change that starts a Motion flight. |
| Mode-transition crossfade double-motions with the camera on entering play | Entering play does an *instant* landing (`apply()`, not `moveTo()`), so no flight overlaps; executor still verifies (D7). |
| Magic Move morph snaps when combined with a long camera flight | §4.3: geometry via property interpolation (not VT), content via crossfade; sequence flight→morph when both are large. |
| Magic Move drags a VT/Motion dependency into the export | §4.4: export uses WAAPI interpolation + opacity crossfade only — no VT, no Motion. `animateView` stays editor-only. |
