// Generates the manual-verification decks for hold frames (Task 8 Step 3 of
// docs/superpowers/plans/2026-08-08-hold-frames.md).
//
// Ids and timestamps are fixed so regenerating produces no spurious diff. Kept as plain
// ESM with no imports from src/ so it runs with bare `node` and cannot drift into needing
// a build step; the shapes below mirror src/types.ts.
import { writeFileSync } from "node:fs";

const STAMP = Date.parse("2026-08-08T00:00:00Z");

const text = (id, content, x, y, { w = 860, size = 44, weight = 600, align = "left", color = "#18181b", z = 0, lifecycle } = {}) => ({
  id,
  type: "text",
  x,
  y,
  w,
  h: Math.round(size * 2.2),
  rotation: 0,
  z,
  content,
  textStyle: { fontSize: size, fontWeight: weight, color, align },
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist", ...lifecycle },
});

// A shot's rect is written directly rather than fitted to its elements, so the padding
// around each group is obvious when you re-capture it from a new view.
const shot = (id, title, x, y, w, h, notes, { rotation = 0, easing = "smooth" } = {}) => ({
  id, title, x, y, w, h, rotation, duration: "auto", easing, notes,
});

// `kind: "hold"` plus the 1x1 placeholder rect is exactly what makeHold() produces —
// resolveFrameRect replaces the geometry at read time.
const hold = (id, title, notes) => ({
  id, title, x: 0, y: 0, w: 1, h: 1, rotation: 0, duration: 0, easing: "cut", notes, kind: "hold",
});

const deck = (id, title, elements, frames) => ({
  id,
  title,
  createdAt: STAMP,
  updatedAt: STAMP,
  world: { backgroundColor: "#f4f4f5" },
  elements,
  frames,
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
});

/* ---------------------------------------------------------------- main deck --------- */

const elements = [
  // A — the canonical bullet build: one element on the shot, three on holds.
  text("el_a_head", "Four bullets, one at a time", 0, -260, { size: 56, weight: 700 }),
  text("el_a_1", "1. Present from the shot itself", 40, 0, { lifecycle: { enterAt: "fr_a", enterEffect: "fade" } }),
  text("el_a_2", "2. Revealed by step 2", 40, 130, { lifecycle: { enterAt: "fr_a_h1", enterEffect: "fade" } }),
  text("el_a_3", "3. Revealed by step 3", 40, 260, { lifecycle: { enterAt: "fr_a_h2", enterEffect: "fade" } }),
  text("el_a_4", "4. Revealed by step 4", 40, 390, { lifecycle: { enterAt: "fr_a_h3", enterEffect: "fade" } }),

  // B — same mechanism with directional entrances, far enough away that the shot
  // transition into it is an unmistakable camera move.
  text("el_b_head", "Entrances other than fade", 3000, -260, { size: 56, weight: 700 }),
  text("el_b_1", "Slides in from the left", 3040, 0, { lifecycle: { enterAt: "fr_b", enterEffect: "slide", enterDirection: "left" } }),
  text("el_b_2", "Slides in from the right", 3040, 130, { lifecycle: { enterAt: "fr_b_h1", enterEffect: "slide", enterDirection: "right" } }),
  text("el_b_3", "Pulses into place", 3040, 260, { lifecycle: { enterAt: "fr_b_h2", enterEffect: "pulse" } }),

  // C — exercises exitAt pointing at a hold, and the delete-cascade fallback rules.
  text("el_c_head", "Leaving mid-build", 0, 1740, { size: 56, weight: 700 }),
  text("el_c_leaves", "This line leaves after step 2", 40, 2000, {
    color: "#b91c1c",
    lifecycle: { enterAt: "fr_c", enterEffect: "fade", onExit: "leave", exitAt: "fr_c_h1", exitEffect: "fade" },
  }),
  text("el_c_replaces", "…and this one takes its place", 40, 2130, {
    lifecycle: { enterAt: "fr_c_h2", enterEffect: "fade" },
  }),

  // D — a rotated shot: its hold must inherit the rotation, not reset to 0.
  text("el_d_head", "Rotated shot", 3000, 1740, { size: 56, weight: 700 }),
  text("el_d_1", "The hold keeps this 12° tilt", 3040, 2000, { lifecycle: { enterAt: "fr_d_h1", enterEffect: "fade" } }),
];

const frames = [
  shot("fr_a", "Bullets", -80, -340, 1100, 940,
    "Step 3 items 4-6. Only bullet 1 is visible on arrival. Press → three times: each bullet fades in with NO camera movement, and the progress bar advances on every press. Then press ← back through it — bullets disappear in reverse."),
  hold("fr_a_h1", "Step 2", "Camera must be identical to “Bullets”. Bullet 2 fades in."),
  hold("fr_a_h2", "Step 3", "Bullet 3 fades in."),
  hold("fr_a_h3", "Step 4", "Bullet 4 fades in. Now press O for overview and resume — the build state must be preserved (item 7)."),

  shot("fr_b", "Entrances", 2920, -340, 1100, 940,
    "A real camera move from the previous group — holds are instant, shots are not. Panel 1 slides in on arrival."),
  hold("fr_b_h1", "Step 2", "Panel 2 slides in from the right, camera still."),
  hold("fr_b_h2", "Step 3", "Panel 3 pulses in, camera still."),

  shot("fr_c", "Leaving", -80, 1660, 1100, 700,
    "The red line enters here and is marked onExit:leave with exitAt on step 2."),
  hold("fr_c_h1", "Step 2", "Last frame the red line is visible — it exits as you leave this step."),
  hold("fr_c_h2", "Step 3", "Red line gone, replacement faded in. Press ← twice: the red line must come back."),

  shot("fr_d", "Rotated", 2920, 1660, 1100, 700,
    "A 12° shot. Its step must stay at the same tilt — a hold inherits rotation, not just position.",
    { rotation: 12 }),
  hold("fr_d_h1", "Step 2", "Still tilted 12°, camera unmoved."),
];

writeFileSync(
  "fixtures/hold-frames-demo.pressure.json",
  JSON.stringify(deck("pres_hold_demo", "Hold frames test deck", elements, frames), null, 2) + "\n"
);

/* ------------------------------------------------------------- edge-case deck ------- */

// A leading hold cannot be authored through the UI (the group rules prevent it), but
// hand-edited and imported JSON can contain one. resolveFrameRect falls back to the first
// shot in the list and holdGroups gives it its own group rather than dropping it.
const edgeElements = [
  text("el_e_1", "Frame 1 is a hold with no shot before it", 0, 0, { w: 1000, size: 40 }),
  text("el_e_2", "It borrows the first shot's camera instead of its 1×1 placeholder", 0, 130, {
    w: 1000, size: 40, lifecycle: { enterAt: "fr_e_shot", enterEffect: "fade" },
  }),
];

const edgeFrames = [
  hold("fr_e_lead", "Leading hold", "Must render at the shot's camera below — NOT an extreme zoom into a 1×1 rect. Check the timeline draws it as its own group, and the presenter view's next-up pane too."),
  shot("fr_e_shot", "The only shot", -80, -80, 1160, 420, "Same camera as the leading hold."),
  hold("fr_e_trail", "Trailing hold", "Ordinary case, for contrast."),
];

writeFileSync(
  "fixtures/hold-frames-edge.pressure.json",
  JSON.stringify(deck("pres_hold_edge", "Hold frames edge cases", edgeElements, edgeFrames), null, 2) + "\n"
);

console.log("wrote fixtures/hold-frames-demo.pressure.json and fixtures/hold-frames-edge.pressure.json");
