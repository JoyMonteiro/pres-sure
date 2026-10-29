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

## `folder-demo/`

A lecture folder: `deck.pressure.json` plus real files in `assets/` (two SVGs and a PNG).
Regenerate with `node scripts/make-folder-demo.mjs`. Folder mode writes into the folder,
so **work on a copy** — never open the fixture itself:

```bash
rm -rf /tmp/folder-demo && cp -R fixtures/folder-demo /tmp/folder-demo
npm run dev   # then open http://localhost:5173 in Chrome or Edge
```

1. **📁 Open folder…** → `/tmp/folder-demo`. The demo deck loads with all three images.
   Move an element; within ~1 s `deck.pressure.json` changes and `index.html` appears
   (`ls -l /tmp/folder-demo`).
2. **Reload** → the *Reopen* overlay appears. Backspace does nothing. *Reopen* → the deck
   and images are back.
3. **Edit `deck.pressure.json` on disk** (e.g. change `"title"`), then click back into the
   tab → the conflict banner appears. Try both *Load from disk* (the new title shows) and,
   after repeating, *Keep mine* (the file is overwritten).
4. **Presenter** → current/next panes show the images.
5. **Serve the folder**: `npx serve /tmp/folder-demo`, open the URL → `index.html` plays
   all three frames with images; console is clean.
6. **Export .html** → move the downloaded file somewhere else and open it: it plays with
   all images (they are embedded again).
7. **Add an image** named `Keeling Curve.PNG` → `assets/keeling-curve.png` appears. Add the
   same file again → no new file.
8. **× on the folder chip** → images stay visible (re-embedded); the chip becomes
   *📁 Open folder…*.
9. **Firefox**: there is no *Open folder…* button and the editor works as before.
