# Manual test decks

Hand-authored presentations for the checks that `npm test` cannot make — camera movement,
entrance animations, export parity and autosave. They cover Task 8 Step 3 of
`docs/superpowers/plans/2026-08-08-hold-frames.md`.

Regenerate with `node scripts/make-test-deck.mjs`; `src/playback/deckFixtures.test.ts`
keeps them structurally honest (no dangling `enterAt`, every hold resolving to its shot).

## Loading one

```bash
npm run dev
```

Then **Import** in the toolbar and pick a `.pressure.json` file from this directory. Import
replaces the current presentation and autosaves over it, so export anything you care about
first.

## `hold-frames-demo.pressure.json`

Four shots, twelve steps. Every frame's speaker notes say what that step is meant to prove,
so the presenter view doubles as the checklist.

| Group | Frames | What it exercises |
|---|---|---|
| Bullets | shot + 3 holds | The core build: one bullet per step, no camera movement, reverse stepping, progress bar advancing per step |
| Entrances | shot + 2 holds | Slide and pulse entrances on holds; a long camera move *into* the group, contrasting with the motionless steps inside it |
| Leaving | shot + 2 holds | `onExit: "leave"` with `exitAt` pointing at a hold — the red line must reappear when you step back |
| Rotated | shot + 1 hold | A 12° shot, whose hold must inherit the rotation rather than snapping upright |

Walk it through as:

1. **Play** (from the first frame). Only bullet 1 is visible.
2. **→ three times.** Each bullet fades in; the camera must not move at all, and the
   progress bar must advance on every press — not only on shot changes.
3. **← back through the build.** Bullets disappear in reverse order.
4. **O** for overview, then resume — build state is preserved.
5. Continue into *Entrances* (a real camera move), *Leaving* (step back to check the red
   line returns) and *Rotated* (the tilt persists across its step).
6. Back in the editor, pan/zoom somewhere new, select the **Bullets** card and
   **Re-capture from current view** — replay: the whole build now happens at the new
   position. This is the live-link guarantee.
7. **Export HTML**, open the file, step through the build. Identical behaviour, clean
   console.
8. Reload the editor — autosave restores the build intact.
9. Open the **presenter view** and step through: the next-up pane stays on the shot's
   camera across every hold, never jumping to an extreme zoom.

## `hold-frames-edge.pressure.json`

A deck whose **first frame is a hold**, which the UI cannot author (the group rules keep
holds behind a shot) but hand-edited or older JSON can contain. It must not blow up:

- The leading hold falls back to the first shot's camera, not its 1×1 placeholder rect —
  if this regresses you get a ~360× zoom into a single pixel.
- The timeline draws it as its own group instead of silently dropping it; a frame the
  timeline never draws would still swallow a click during playback.
- The presenter view's next-up pane must survive it too.

## Web images (no fixture file)

Checks for `docs/superpowers/specs/2026-10-14-web-images-design.md`. Run the editor on a
spare port so its autosave doesn't touch your real deck: `npx vite --port 5191`.

1. *+ From web* → paste the Newton snippet (spec §8) → preview, credit and *1920 × 2312 px*;
   *Add* → portrait with correct proportions and the caption beneath; one ⌘Z removes both.
2. Zoom into the portrait until it fills the screen — no blur hint.
3. Paste `https://en.wikipedia.org/wiki/Isaac_Newton#/media/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg`
   → resolves; credit built from metadata.
4. Paste `https://commons.wikimedia.org/wiki/File:Wikipedia-logo-v2.svg` → stays sharp at
   deep zoom.
5. With *Save a copy* ticked → *Save .json* shows a `data:` URI for that image; reopen the
   dialog → the box is still ticked.
6. A linked image's properties panel shows *Linked from upload.wikimedia.org* (or
   `thumb.wikimedia.org`); *Save a copy* converts it.
7. ⌘V a snippet onto the canvas with nothing selected → dialog opens pre-filled. ⌘V inside
   a text box → normal paste.
8. *Export .html* with one linked and one copied image → both show online; with the network
   off only the copied one shows.
9. A non-Wikimedia image URL from a site without CORS → linking works; copying reports
   *This site doesn't allow copying — add it as a link instead.*
