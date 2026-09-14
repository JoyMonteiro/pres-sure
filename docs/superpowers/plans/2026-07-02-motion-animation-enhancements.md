# Motion Animation Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic staggered group entrances, a spring "pop" entrance effect (with export parity via CSS `linear()` easing), and View-Transition-animated timeline reordering to pres-sure.

**Architecture:** pres-sure has three animation layers: a van Wijk camera engine (untouched by this plan), Motion-variant element lifecycle effects in the editor (`src/components/ElementView.tsx` gated by pure functions in `src/playback/`), and a dependency-free vanilla-JS export runtime (`src/export/runtime.ts`) that mirrors the editor's behavior with WAAPI. New behavior is defined once in pure, unit-tested TypeScript functions and consumed by both the editor and the export runtime. See `docs/animation-enhancements-design.md` for rationale.

**Tech Stack:** Vite 6, React 18, TypeScript 5.7, motion (v11 → v12 in Task 8), zustand, vitest (added in Task 1).

## Global Constraints

- The exported `.html` must remain dependency-free: never import or bundle Motion (or anything else) into `src/export/runtime.ts`'s emitted script. Build-time interpolation of computed constants into the runtime string is fine.
- `prefers-reduced-motion: reduce` must collapse every new animation to instant, exactly as existing effects do.
- Tasks 1–7 must work on `motion@11.18.2` (do not use `animateView`, `stagger()` from motion, or any v12-only API before Task 8).
- After every task: `npm run typecheck` passes and `npm run test` passes.
- Dev server for manual checks: `npm run dev`, open http://localhost:5173. Playback = "Present" button in the toolbar (or add frames via "+ Frame from view" first).
- The camera engine (`src/playback/engine.ts`, `src/camera/*`) is out of scope — do not modify it.
- **View-transition coexistence (design doc D8):** the browser View Transitions API (`animateView` / `startViewTransition`) is **editor-only** — never used in `src/export/runtime.ts`. Never wrap a state change that also starts a Motion camera/element flight, and keep VT entry points on distinct, non-animating chrome so two can't fire in one tick. High-frequency direct-manipulation changes (element selection, canvas edits) use `AnimatePresence`, not view transitions.
- **Phasing:** Tasks 1–11 are Phase 1 (ship-ready). Tasks 12–15 are Phase 2 (Magic Move) — speculative and clearly optional; implement only if Phase 1 lands well. Task 16 (docs + final verification) covers whatever shipped.

---

### Task 1: Vitest test infrastructure

**Files:**
- Modify: `package.json` (add `test` script + vitest devDependency via npm)
- Test: `src/playback/visibility.test.ts`

**Interfaces:**
- Consumes: existing `visibilityAt(el, frames, currentIndex)` from `src/playback/visibility.ts`.
- Produces: a working `npm run test` command that later tasks' tests rely on.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add the test script**

In `package.json`, change the `scripts` block from:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit"
  },
```

to:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run"
  },
```

(Vitest picks up the existing `vite.config.ts` automatically; no vitest config file is needed for pure-function tests.)

- [ ] **Step 3: Write a characterization test for the existing pure visibility function**

Create `src/playback/visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { visibilityAt } from "./visibility";
import type { Element, Frame } from "../types";

const frame = (id: string): Frame => ({
  id,
  title: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  duration: "auto",
  easing: "smooth",
  notes: "",
});

const el = (lifecycle: Partial<Element["lifecycle"]>): Element => ({
  id: "e1",
  type: "text",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z: 0,
  content: "",
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist", ...lifecycle },
});

const frames = [frame("f1"), frame("f2"), frame("f3")];

describe("visibilityAt", () => {
  it("element with no enterAt is visible from the start and never 'entering'", () => {
    expect(visibilityAt(el({}), frames, 0)).toEqual({ visible: true, entering: false, leaving: false });
  });

  it("element entering at f2 is hidden at f1, entering at f2, plain-visible at f3", () => {
    const e = el({ enterAt: "f2", enterEffect: "fade" });
    expect(visibilityAt(e, frames, 0).visible).toBe(false);
    expect(visibilityAt(e, frames, 1)).toEqual({ visible: true, entering: true, leaving: false });
    expect(visibilityAt(e, frames, 2)).toEqual({ visible: true, entering: false, leaving: false });
  });

  it("leave element is 'leaving' on its exit frame and hidden past it", () => {
    const e = el({ enterAt: "f1", onExit: "leave", exitAt: "f2", exitEffect: "fade" });
    expect(visibilityAt(e, frames, 1).leaving).toBe(true);
    expect(visibilityAt(e, frames, 2).visible).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: 3 tests PASS (these characterize existing behavior; if any fail, stop — you've found a real discrepancy, do not "fix" the test).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add package.json package-lock.json src/playback/visibility.test.ts
git commit -m "test: add vitest harness + visibility characterization tests"
```

---

### Task 2: Stagger ordering utility (pure function)

**Files:**
- Create: `src/playback/stagger.ts`
- Test: `src/playback/stagger.test.ts`

**Interfaces:**
- Consumes: `visibilityAt(el: Element, frames: Frame[], currentIndex: number): VisState` from `src/playback/visibility.ts`.
- Produces: `STAGGER_STEP_S: number` (= 0.06) and `enterOrder(elements: Element[], frames: Frame[], currentIndex: number): Map<string, number>` — element id → 0-based entrance position among elements entering at this frame. Tasks 3 and 4 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/playback/stagger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enterOrder, STAGGER_STEP_S } from "./stagger";
import type { Element, Frame } from "../types";

const frame = (id: string): Frame => ({
  id,
  title: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  duration: "auto",
  easing: "smooth",
  notes: "",
});

const el = (id: string, z: number, enterAt: string | null): Element => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z,
  content: "",
  lifecycle: { enterAt, enterEffect: "fade", onExit: "persist" },
});

const frames = [frame("f1"), frame("f2")];

describe("enterOrder", () => {
  it("orders same-frame entrances back-to-front by z", () => {
    const els = [el("a", 5, "f2"), el("b", 1, "f2"), el("c", 3, "f2")];
    const order = enterOrder(els, frames, 1);
    expect(order.get("b")).toBe(0);
    expect(order.get("c")).toBe(1);
    expect(order.get("a")).toBe(2);
  });

  it("excludes elements not entering at this frame", () => {
    const els = [el("a", 0, "f2"), el("b", 1, null)];
    const order = enterOrder(els, frames, 1);
    expect(order.has("b")).toBe(false);
    expect(order.get("a")).toBe(0);
  });

  it("exposes a 60ms stagger step", () => {
    expect(STAGGER_STEP_S).toBe(0.06);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `Cannot find module './stagger'` (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

Create `src/playback/stagger.ts`:

```ts
// Deterministic entrance ordering for elements that enter at the same frame (§ D2
// of docs/animation-enhancements-design.md). Ripples back-to-front by z, 60ms apart.
// Shared mental model with the export runtime (which re-implements it in plain JS).
import type { Element, Frame } from "../types";
import { visibilityAt } from "./visibility";

export const STAGGER_STEP_S = 0.06;

/** Element id -> 0-based entrance position among elements entering at this frame. */
export function enterOrder(
  elements: Element[],
  frames: Frame[],
  currentIndex: number
): Map<string, number> {
  const entering = elements
    .filter((e) => visibilityAt(e, frames, currentIndex).entering)
    .sort((a, b) => a.z - b.z);
  return new Map(entering.map((e, i) => [e.id, i]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/playback/stagger.ts src/playback/stagger.test.ts
git commit -m "feat: add pure entrance-stagger ordering utility"
```

---

### Task 3: Stagger in editor playback (Stage + PlaybackElement)

**Files:**
- Modify: `src/components/Stage.tsx`
- Modify: `src/components/ElementView.tsx` (only `PlaybackElement` and `variantsFor`, lines ~57–74 and ~136–176)

**Interfaces:**
- Consumes: `enterOrder`, `STAGGER_STEP_S` from `src/playback/stagger.ts` (Task 2).
- Produces: `PlaybackElement` gains an optional `staggerIndex?: number` prop (default 0). `variantsFor` now also returns a `transition` object. Task 6 modifies this same `variantsFor`.

- [ ] **Step 1: Thread stagger order through Stage**

In `src/components/Stage.tsx`, add the import:

```ts
import { enterOrder } from "../playback/stagger";
```

Inside `Stage`, after `const els = [...presentation.elements].sort((a, b) => a.z - b.z);`, add:

```ts
const order = enterOrder(els, presentation.frames, currentIndex);
```

In the `AnimatePresence` branch, change the `PlaybackElement` render to:

```tsx
return (
  <PlaybackElement
    key={el.id}
    el={el}
    entering={v.entering}
    leaving={v.leaving}
    staggerIndex={order.get(el.id) ?? 0}
  />
);
```

(Leave the non-animated branch as-is — `entering` is always `false` there, so the default `staggerIndex` is fine.)

- [ ] **Step 2: Apply the delay in PlaybackElement / variantsFor**

In `src/components/ElementView.tsx`, add the import:

```ts
import { STAGGER_STEP_S } from "../playback/stagger";
```

Replace the whole `PlaybackElement` function with:

```tsx
/** Read-only element used in playback / presenter / thumbnails. */
export function PlaybackElement({
  el,
  entering,
  leaving,
  staggerIndex = 0,
}: {
  el: Element;
  entering: boolean;
  leaving: boolean;
  staggerIndex?: number;
}) {
  const v = variantsFor(el, entering, leaving, staggerIndex);
  return (
    <motion.div
      className="element"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
      initial={v.initial}
      animate={v.animate}
      exit={v.exit}
      transition={v.transition}
    >
      <div className="content" style={{ transform: `rotate(${el.rotation}deg)`, width: "100%", height: "100%" }}>
        <ElementBody el={el} editable={false} />
      </div>
    </motion.div>
  );
}
```

Replace the whole `variantsFor` function at the bottom of the file with:

```tsx
function variantsFor(el: Element, entering: boolean, leaving: boolean, staggerIndex: number) {
  const lc = el.lifecycle;
  const off = 80;
  const dir = lc.enterDirection ?? "left";
  const slideFrom =
    dir === "left"
      ? { x: -off, y: 0 }
      : dir === "right"
        ? { x: off, y: 0 }
        : dir === "up"
          ? { x: 0, y: -off }
          : { x: 0, y: off };

  const delay = entering ? staggerIndex * STAGGER_STEP_S : 0;

  let initial: Record<string, number> = {};
  let animate: Record<string, number | number[]> = { opacity: 1, x: 0, y: 0, scale: 1 };
  let transition: Record<string, unknown> = { duration: 0.5, ease: [0.4, 0, 0.2, 1], delay };

  if (entering) {
    switch (lc.enterEffect) {
      case "fade":
        initial = { opacity: 0 };
        break;
      case "slide":
        initial = { opacity: 0, ...slideFrom };
        break;
      case "pulse":
        animate = { opacity: 1, scale: [1, 1.08, 1] };
        break;
      case "appear":
      case "none":
      default:
        initial = {};
    }
  }

  // Exits keep their own timing so a staggered entrance never delays a fade-out.
  let exit: Record<string, unknown> = { opacity: 1 };
  if (leaving && lc.onExit === "leave") {
    const target = lc.exitEffect === "slide" ? { opacity: 0, ...slideFrom } : { opacity: 0 };
    exit = { ...target, transition: { duration: 0.4, ease: "easeIn" } };
  }

  return { initial, animate, exit, transition };
}
```

- [ ] **Step 3: Typecheck and run automated tests**

Run: `npm run typecheck && npm run test`
Expected: both PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open http://localhost:5173. Create three text elements (toolbar), select each and set **Lifecycle → Enters at** to the same frame (create a second frame first via "+ Frame from view") with **Entrance effect: fade**. Press **Present** and step to that frame.
Expected: the three elements fade in one after another (~60 ms apart, back-to-front by stacking order), not simultaneously. Step backward then forward: behavior repeats deterministically.

- [ ] **Step 5: Commit**

```bash
git add src/components/Stage.tsx src/components/ElementView.tsx
git commit -m "feat: stagger same-frame element entrances in editor playback"
```

---

### Task 4: Stagger in the export runtime

**Files:**
- Modify: `src/export/runtime.ts` (the `render` and `entrance` functions inside the template string, lines ~96–109)

**Interfaces:**
- Consumes: nothing new (plain-JS mirror of Task 2's ordering; the `elements` array in the runtime is already z-sorted at line 10).
- Produces: runtime `entrance(el, node, delay)` signature (Task 7 extends this same function).

- [ ] **Step 1: Move the "entering at this frame" check into render() and pass a stagger delay**

In `src/export/runtime.ts`, replace the `render` function:

```js
  function render(i){
    elements.forEach(function(el){
      var on=visAt(el,i), node=nodes[el.id], wasOn=node.style.display!=='none';
      if(on&&!wasOn){ node.style.display=''; entrance(el,node); }
      else if(!on&&wasOn){ exit(el,node); }
    });
  }
```

with (elements are already z-sorted, so iteration order == entrance order):

```js
  function render(i){
    var k=0;
    elements.forEach(function(el){
      var on=visAt(el,i), node=nodes[el.id], wasOn=node.style.display!=='none';
      if(on&&!wasOn){
        node.style.display='';
        var lc=el.lifecycle||{};
        if(lc.enterAt&&idxOf(lc.enterAt)===i){ entrance(el,node,(k++)*60); }
      }
      else if(!on&&wasOn){ exit(el,node); }
    });
  }
```

- [ ] **Step 2: Apply the delay in entrance() with fill:'backwards'**

Replace the `entrance` function:

```js
  function entrance(el,node){
    if(reduced) return; var lc=el.lifecycle||{}; if(idxOf(lc.enterAt)!==index) return;
    var eff=lc.enterEffect;
    if(eff==='fade'){ node.animate([{opacity:0},{opacity:1}],{duration:500,easing:'ease-out'}); }
    else if(eff==='slide'){ var o=offset(lc.enterDirection); node.animate([{opacity:0,transform:'translate('+o.x+'px,'+o.y+'px)'},{opacity:1,transform:'none'}],{duration:500,easing:'ease-out'}); }
    else if(eff==='pulse'){ node.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],{duration:600}); }
  }
```

with (`fill:'backwards'` holds the first keyframe during the delay so staggered elements don't flash in early; the enter-frame check moved to `render`):

```js
  function entrance(el,node,delay){
    if(reduced) return; var lc=el.lifecycle||{}; var eff=lc.enterEffect;
    var opts={duration:500,easing:'ease-out',delay:delay||0,fill:'backwards'};
    if(eff==='fade'){ node.animate([{opacity:0},{opacity:1}],opts); }
    else if(eff==='slide'){ var o=offset(lc.enterDirection); node.animate([{opacity:0,transform:'translate('+o.x+'px,'+o.y+'px)'},{opacity:1,transform:'none'}],opts); }
    else if(eff==='pulse'){ node.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],{duration:600,delay:delay||0,fill:'backwards'}); }
  }
```

- [ ] **Step 3: Typecheck, test, build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Manual verification of an exported file**

Run: `npm run dev`. Using the Task 3 test presentation (3 elements fading in at one frame), click **Export HTML** in the toolbar, open the downloaded file in a browser, and step to the entrance frame.
Expected: same staggered ripple as the editor; stepping backward past the frame and forward again replays it. No element flashes at full opacity before its delayed fade.

- [ ] **Step 5: Commit**

```bash
git add src/export/runtime.ts
git commit -m "feat: mirror entrance stagger in the exported runtime"
```

---

### Task 5: Spring curve sampler → CSS linear() easing (pure function)

**Files:**
- Create: `src/export/spring.ts`
- Test: `src/export/spring.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SPRING_STIFFNESS = 260`, `SPRING_DAMPING = 18`, `springProgress(stiffness: number, damping: number, t: number): number`, and `springLinearEasing(stiffness: number, damping: number, samples?: number): { easing: string; durationMs: number }`. Tasks 6 and 7 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/export/spring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SPRING_DAMPING, SPRING_STIFFNESS, springLinearEasing, springProgress } from "./spring";

describe("springProgress", () => {
  it("starts at 0 and settles at 1", () => {
    expect(springProgress(SPRING_STIFFNESS, SPRING_DAMPING, 0)).toBeCloseTo(0, 5);
    expect(springProgress(SPRING_STIFFNESS, SPRING_DAMPING, 10)).toBeCloseTo(1, 3);
  });

  it("overshoots past 1 for an underdamped spring (the visible bounce)", () => {
    let max = 0;
    for (let t = 0; t <= 1.5; t += 0.01) {
      max = Math.max(max, springProgress(SPRING_STIFFNESS, SPRING_DAMPING, t));
    }
    expect(max).toBeGreaterThan(1.05);
  });
});

describe("springLinearEasing", () => {
  it("emits a linear() string starting at 0 and ending at exactly 1, with a sane duration", () => {
    const { easing, durationMs } = springLinearEasing(SPRING_STIFFNESS, SPRING_DAMPING);
    expect(easing.startsWith("linear(0")).toBe(true);
    expect(easing.endsWith(", 1)")).toBe(true);
    expect(durationMs).toBeGreaterThan(400);
    expect(durationMs).toBeLessThan(1500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `./spring`.

- [ ] **Step 3: Write the implementation**

Create `src/export/spring.ts`:

```ts
// Closed-form damped-spring progress curve, sampled at export build time into a CSS
// linear() easing string so the dependency-free runtime can replay the editor's
// springy entrance via WAAPI (§ D3 of docs/animation-enhancements-design.md).

export const SPRING_STIFFNESS = 260;
export const SPRING_DAMPING = 18;

/** Progress (0->1, may overshoot) of a unit-mass spring at time t seconds. */
export function springProgress(stiffness: number, damping: number, t: number): number {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * Math.sqrt(stiffness));
  if (zeta >= 1) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

/** Sample the spring into a CSS linear() easing + the duration it settles in. */
export function springLinearEasing(
  stiffness: number,
  damping: number,
  samples = 40
): { easing: string; durationMs: number } {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * Math.sqrt(stiffness));
  // Settled when the decay envelope drops below 0.1% (ln(1000) ≈ 6.9).
  const durationS = Math.min(2.5, 6.9 / (Math.max(zeta, 0.05) * w0));
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = i === samples ? 1 : springProgress(stiffness, damping, (i / samples) * durationS);
    pts.push(String(Math.round(v * 10000) / 10000));
  }
  return { easing: `linear(${pts.join(", ")})`, durationMs: Math.round(durationS * 1000) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: all PASS. (Sanity: stiffness 260 / damping 18 gives ζ ≈ 0.56, so durationMs ≈ 770 and peak overshoot ≈ 1.12.)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/export/spring.ts src/export/spring.test.ts
git commit -m "feat: add spring->CSS linear() easing sampler"
```

---

### Task 6: "spring" entrance effect in the editor

**Files:**
- Modify: `src/types.ts:5` (the `EnterEffect` union)
- Modify: `src/components/PropertiesPanel.tsx:133` (the effect option list)
- Modify: `src/components/ElementView.tsx` (`variantsFor` — as rewritten in Task 3)

**Interfaces:**
- Consumes: `SPRING_STIFFNESS`, `SPRING_DAMPING` from `src/export/spring.ts` (Task 5); the Task 3 version of `variantsFor` (with `staggerIndex` param and returned `transition`).
- Produces: `EnterEffect` union includes `"spring"`. Task 7 relies on the `"spring"` value reaching exported data.

- [ ] **Step 1: Extend the type**

In `src/types.ts`, change:

```ts
export type EnterEffect = "none" | "appear" | "fade" | "slide" | "pulse";
```

to:

```ts
export type EnterEffect = "none" | "appear" | "fade" | "slide" | "pulse" | "spring";
```

- [ ] **Step 2: Add the option to the Properties panel**

In `src/components/PropertiesPanel.tsx` (Lifecycle section, ~line 133), change:

```tsx
          {["none", "appear", "fade", "slide", "pulse"].map((x) => (
```

to:

```tsx
          {["none", "appear", "fade", "slide", "pulse", "spring"].map((x) => (
```

- [ ] **Step 3: Handle the effect in variantsFor**

In `src/components/ElementView.tsx`, add to the imports:

```ts
import { SPRING_DAMPING, SPRING_STIFFNESS } from "../export/spring";
```

In `variantsFor`'s `switch (lc.enterEffect)`, add a case directly after `case "pulse": ... break;`:

```tsx
      case "spring":
        initial = { opacity: 0, scale: 0.6 };
        transition = { type: "spring", stiffness: SPRING_STIFFNESS, damping: SPRING_DAMPING, delay };
        break;
```

- [ ] **Step 4: Typecheck, test, and manually verify**

Run: `npm run typecheck && npm run test`
Expected: PASS.

Then `npm run dev`: give an element **Entrance effect: spring** entering at frame 2, present, and step into that frame.
Expected: the element pops in — scales up from 60% with a visible overshoot bounce, fading in. Combined with other same-frame entrances it still staggers.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/components/PropertiesPanel.tsx src/components/ElementView.tsx
git commit -m "feat: add spring 'pop' entrance effect in editor playback"
```

---

### Task 7: "spring" entrance in the export runtime

**Files:**
- Modify: `src/export/runtime.ts` (imports + template header + the Task 4 version of `entrance`)

**Interfaces:**
- Consumes: `springLinearEasing`, `SPRING_STIFFNESS`, `SPRING_DAMPING` from `src/export/spring.ts` (Task 5); runtime `entrance(el, node, delay)` (Task 4).
- Produces: exported files play `enterEffect: "spring"`.

- [ ] **Step 1: Interpolate the sampled easing into the runtime string**

In `src/export/runtime.ts`, add at the top of the file:

```ts
import { SPRING_DAMPING, SPRING_STIFFNESS, springLinearEasing } from "./spring";
```

Change the start of `runtimeScript` from:

```ts
export function runtimeScript(): string {
  return String.raw`
(function(){
  var DATA = window.__PRES__;
```

to:

```ts
export function runtimeScript(): string {
  const spring = springLinearEasing(SPRING_STIFFNESS, SPRING_DAMPING);
  return String.raw`
(function(){
  var DATA = window.__PRES__;
  var SPRING_EASE=${JSON.stringify(spring.easing)}, SPRING_MS=${spring.durationMs};
  var springOK = typeof CSS!=='undefined' && CSS.supports && CSS.supports('animation-timing-function','linear(0, 1)');
```

- [ ] **Step 2: Handle the effect in entrance()**

In the runtime's `entrance` function (Task 4 version), add a branch after the `pulse` branch:

```js
    else if(eff==='spring'){
      node.animate([{opacity:0,transform:'scale(0.6)'},{opacity:1,transform:'scale(1)'}],
        springOK?{duration:SPRING_MS,easing:SPRING_EASE,delay:delay||0,fill:'backwards'}:opts);
    }
```

(`opts` is the generic 500ms ease-out fallback already defined in `entrance` — browsers without CSS `linear()` get a plain fade-and-scale.)

- [ ] **Step 3: Typecheck, test, build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Manual verification of an exported file**

`npm run dev` → export the Task 6 presentation → open the `.html` → step into the spring element's frame.
Expected: the same overshoot pop as the editor (timing won't be pixel-identical to Motion's spring, but the bounce character must match). View source of the exported file and confirm `SPRING_EASE="linear(0, ...)"` is embedded and there is no `import` or external URL in the runtime script.

- [ ] **Step 5: Commit**

```bash
git add src/export/runtime.ts
git commit -m "feat: play spring entrance in exported runtime via CSS linear() easing"
```

---

### Task 8: Upgrade motion v11 → v12

**Files:**
- Modify: `package.json` / `package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing.
- Produces: `animateView` importable from `"motion"` (required by Task 9).

- [ ] **Step 1: Upgrade**

```bash
npm install motion@^12
```

- [ ] **Step 2: Confirm animateView exists in the installed version**

The `motion` package is a thin re-export of `framer-motion/dom`, which re-exports `motion-dom` — so check `motion-dom`, not `motion` itself:

Run: `grep -c "animateView" node_modules/motion-dom/dist/index.d.ts`
Expected: 2 or more matches, including the declaration `declare function animateView(update: () => void | Promise<void>, options?: ViewTransitionOptions): ViewTransitionBuilder` (verified present in motion-dom@12.42.2). If there are no matches, install the latest: `npm install motion@latest` and re-check.

- [ ] **Step 3: Typecheck, test, build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS. Our motion surface is small (`animate` from `"motion"`; `motion`/`AnimatePresence` from `"motion/react"`) and stable across v11→v12; if typecheck breaks, fix call sites per the error messages rather than pinning back.

- [ ] **Step 4: Manual smoke test**

`npm run dev`: present a deck — camera flights (smooth/snappy presets), element entrances (fade/slide/pulse/spring + stagger), overview toggle (O key), and the presenter view must all behave as before.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade motion to v12 (animateView in free core)"
```

---

### Task 9: View-transition polish for the timeline strip

**Files:**
- Modify: `src/components/Timeline.tsx`

**Interfaces:**
- Consumes: `animateView` from `"motion"` (Task 8); existing store actions `reorderFrames(from: number, to: number)`, `duplicateFrame(id: string)`, `removeFrame(id: string)`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the transition helper**

In `src/components/Timeline.tsx`, add imports:

```ts
import { flushSync } from "react-dom";
import { animateView } from "motion";
```

Add this module-level function above `export function Timeline()`:

```tsx
/**
 * Animate frame-card layout changes via the View Transitions API. Progressive
 * enhancement: unsupported browsers and reduced-motion users mutate instantly.
 * flushSync forces React to commit the store update inside the transition callback.
 */
function withCardsTransition(mutate: () => void) {
  const ok =
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!ok) {
    mutate();
    return;
  }
  animateView(() => flushSync(mutate)).add(".frame-card");
}
```

This exact usage is verified against motion-dom@12.42.2 typings: `animateView(update, options?): ViewTransitionBuilder` with `add(subject: ViewTransitionTargetDefinition, newSubject?): this`. If a future motion version rejects it anyway, do NOT fight it — replace the `animateView` line with the raw API, which gives a default crossfade instead of per-card morphs:

```tsx
  (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() =>
    flushSync(mutate)
  );
```

- [ ] **Step 2: Wrap the three mutations**

In the `onDrop` handler, change:

```tsx
            onDrop={() => {
              if (dragIdx.current !== null && dragIdx.current !== i) reorderFrames(dragIdx.current, i);
              dragIdx.current = null;
              setDragging(null);
            }}
```

to:

```tsx
            onDrop={() => {
              const from = dragIdx.current;
              if (from !== null && from !== i) withCardsTransition(() => reorderFrames(from, i));
              dragIdx.current = null;
              setDragging(null);
            }}
```

Change the Dup button handler body from `duplicateFrame(f.id);` to `withCardsTransition(() => duplicateFrame(f.id));` and the Del button handler body from `removeFrame(f.id);` to `withCardsTransition(() => removeFrame(f.id));`.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 4: Manual verification (Chrome or Safari 18+)**

`npm run dev`: create 4+ frames, then in the timeline (a) drag a card to a new slot, (b) duplicate a card, (c) delete a card.
Expected: remaining cards glide to their new positions instead of jumping. Undo (Cmd+Z) still works. With OS reduced-motion enabled (or in Firefox without View Transitions), everything still functions with instant jumps and no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline.tsx
git commit -m "feat: animate timeline reorder/dup/delete with view transitions"
```

---

### Task 10: Properties panel selection crossfade (AnimatePresence) — Phase 1

**Files:**
- Modify: `src/components/PropertiesPanel.tsx` (the `PropertiesPanel` component, lines ~7–29)

**Interfaces:**
- Consumes: `AnimatePresence`, `motion`, `useReducedMotion` from `"motion/react"` (works on v11 and v12).
- Produces: nothing consumed later.

Rationale (design doc D6): selection changes fire on every canvas click, so a whole-page view transition is the wrong tool. `AnimatePresence` scopes the crossfade to the panel subtree, keyed on the *category* (element vs frame) so reselecting between two elements does not re-animate.

- [ ] **Step 1: Wrap the swap in AnimatePresence**

In `src/components/PropertiesPanel.tsx`, change the import line:

```ts
import { useStore } from "../store/store";
```

to add the Motion import directly below it:

```ts
import { useStore } from "../store/store";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
```

Then replace the `PropertiesPanel` component body (the `return (...)` in lines ~17–28) so the selected branch is wrapped:

```tsx
export function PropertiesPanel() {
  const elements = useStore((s) => s.presentation.elements);
  const frames = useStore((s) => s.presentation.frames);
  const selectedIds = useStore((s) => s.selectedIds);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const bg = useStore((s) => s.presentation.world.backgroundColor);
  const setBackground = useStore((s) => s.setBackground);
  const reduce = useReducedMotion();

  const sel = elements.find((e) => selectedIds.length === 1 && e.id === selectedIds[0]);
  const branch = sel ? "element" : "frame";

  return (
    <div className="props">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={branch}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.15 }}
        >
          {sel ? <ElementProps id={sel.id} /> : <FrameProps id={currentFrameId} />}
        </motion.div>
      </AnimatePresence>
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
      <h3>World</h3>
      <div className="field">
        <label>Background</label>
        <input type="color" value={bg} onChange={(e) => setBackground(e.target.value)} />
      </div>
      {!sel && frames.length === 0 && <p className="hint">Add elements and capture frames to begin.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and test**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 3: Manual verification**

`npm run dev`: click an element (panel shows element props), then click empty canvas (panel shows frame/world props).
Expected: the panel content crossfades (~150 ms) instead of cutting. Clicking between two different elements does NOT re-crossfade (same branch). With OS reduced-motion enabled, the swap is instant.

- [ ] **Step 4: Commit**

```bash
git add src/components/PropertiesPanel.tsx
git commit -m "feat: crossfade properties panel on selection-category change"
```

---

### Task 11: Mode-transition crossfade + shared view-transition helper — Phase 1

**Files:**
- Create: `src/playback/viewTransition.ts`
- Test: `src/playback/viewTransition.test.ts`
- Modify: `src/components/Toolbar.tsx` (Present button, line ~91)
- Modify: `src/components/Player.tsx` (Exit button line ~143; Escape case line ~116)

**Interfaces:**
- Consumes: `animateView` from `"motion"` (Task 8).
- Produces: `canViewTransition(): boolean` and `runViewTransition(mutate: () => void, selector?: string): void` from `src/playback/viewTransition.ts`, available for any future editor-chrome transition. (Magic Move content morphs deliberately use Motion inside the camera-transformed world instead — design doc §4.3 — so they do not consume this helper.)

Rationale (design doc D7): entering/leaving present mode hard-swaps the whole app shell. A default whole-page view transition crossfades it. Safe from camera conflict because entering play performs an *instant* landing (`Player.tsx` initial-landing effect calls `apply()`, not an animated `moveTo()`), and exiting is static.

- [ ] **Step 1: Write the helper**

Create `src/playback/viewTransition.ts`:

```ts
// Editor-only View Transitions helper (design doc D4/D7/D8). Progressive enhancement:
// unsupported browsers and reduced-motion users mutate instantly. NEVER used by the
// export runtime (src/export/runtime.ts) — that would rasterize during camera flights.
import { flushSync } from "react-dom";
import { animateView } from "motion";

/** True when the View Transitions API is available and motion is allowed. */
export function canViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run `mutate` inside a view transition. flushSync forces React to commit the DOM
 * change synchronously inside the transition callback. Pass `selector` to scope
 * per-element morphs; omit it for a default whole-page crossfade.
 */
export function runViewTransition(mutate: () => void, selector?: string): void {
  if (!canViewTransition()) {
    mutate();
    return;
  }
  const builder = animateView(() => flushSync(mutate));
  if (selector) builder.add(selector);
}
```

- [ ] **Step 2: Write the failing test**

Create `src/playback/viewTransition.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { canViewTransition, runViewTransition } from "./viewTransition";

describe("view transition fallback", () => {
  it("reports unavailable in the test environment (no document.startViewTransition)", () => {
    expect(canViewTransition()).toBe(false);
  });

  it("runs the mutation directly when view transitions are unavailable", () => {
    const fn = vi.fn();
    runViewTransition(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm run test`
Expected: PASS. If importing `"motion"` throws in the node test environment (it is written for SSR-safety, so this is unlikely), add `// @vitest-environment jsdom` as the first line of the test file and `npm install -D jsdom`; under jsdom `startViewTransition` is still absent, so `canViewTransition()` remains `false` and the assertions hold.

- [ ] **Step 4: Wrap the Present button**

In `src/components/Toolbar.tsx`, add to the imports:

```ts
import { runViewTransition } from "../playback/viewTransition";
```

Change the Present button (line ~91):

```tsx
        <button className="primary" onClick={() => setMode("play")}>
          ▶ Present
        </button>
```

to:

```tsx
        <button className="primary" onClick={() => runViewTransition(() => setMode("play"))}>
          ▶ Present
        </button>
```

- [ ] **Step 5: Wrap the exit paths in Player**

In `src/components/Player.tsx`, add to the imports:

```ts
import { runViewTransition } from "../playback/viewTransition";
```

Change the Escape case in the keyboard handler (line ~116) from:

```tsx
        case "Escape":
          setMode("edit");
          break;
```

to:

```tsx
        case "Escape":
          runViewTransition(() => setMode("edit"));
          break;
```

Change the Exit button (line ~143) from:

```tsx
        <button onClick={() => setMode("edit")}>Exit (Esc)</button>
```

to:

```tsx
        <button onClick={() => runViewTransition(() => setMode("edit"))}>Exit (Esc)</button>
```

- [ ] **Step 6: Typecheck, test, verify**

Run: `npm run typecheck && npm run test`
Expected: PASS.

Then `npm run dev` in Chrome/Safari 18+: click **▶ Present** — the editor crossfades into the player and lands on frame 1 with no double-motion or snap. Navigate a couple of frames (camera flights unaffected). Press **Esc** — crossfades back to the editor. In Firefox (no View Transitions) and with OS reduced-motion, both transitions are instant with no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/playback/viewTransition.ts src/playback/viewTransition.test.ts src/components/Toolbar.tsx src/components/Player.tsx
git commit -m "feat: crossfade edit<->present mode change via view transitions"
```

---

> **Tasks 12–15 are Phase 2 (Magic Move) — speculative.** Implement only if Phase 1 (Tasks 1–11) shipped and the feature is still wanted. They are specified against the codebase at full rigor for the deterministic core (data model, resolution, store, export mirror); the two animation-layer tasks (14, 15) include an explicit validation spike because the morph-vs-camera interaction (design doc §4.3) needs to be seen running before it's locked. When actually scheduled, Tasks 14 and 15 may each be split further. See design doc §4 for the full design.

### Task 12: Magic Move data model + resolution (pure, tested) — Phase 2

**Files:**
- Modify: `src/types.ts` (add `ElementOverride`; add `overrides` to `Frame`)
- Create: `src/playback/resolve.ts`
- Test: `src/playback/resolve.test.ts`
- Modify: `src/store/store.ts` (add `setFrameOverride` action + its interface signature)

**Interfaces:**
- Consumes: existing `Element`, `Frame`, `TextStyle` from `src/types.ts`.
- Produces: `ElementOverride` type; `resolveElementAt(el: Element, frames: Frame[], currentIndex: number): Element`; store action `setFrameOverride(frameId: string, elementId: string, patch: ElementOverride | null): void`. Tasks 13–15 rely on these exact names.

- [ ] **Step 1: Extend the types**

In `src/types.ts`, add after the `Frame` interface:

```ts
/** Per-frame Magic Move override: an element morphs to these values from this frame onward. */
export interface ElementOverride {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  content?: string;
  textStyle?: Partial<TextStyle>;
}
```

And add one field to the existing `Frame` interface (after `notes: string;`):

```ts
  /** elementId -> Magic Move override applied from this frame onward (sticky). */
  overrides?: Record<string, ElementOverride>;
```

- [ ] **Step 2: Write the failing test**

Create `src/playback/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveElementAt } from "./resolve";
import type { Element, Frame } from "../types";

const frame = (id: string, overrides?: Frame["overrides"]): Frame => ({
  id,
  title: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  duration: "auto",
  easing: "smooth",
  notes: "",
  overrides,
});

const base: Element = {
  id: "e1",
  type: "text",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z: 0,
  content: "hello",
  textStyle: { fontSize: 20, fontWeight: 400, color: "#000", align: "left" },
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
};

describe("resolveElementAt", () => {
  const frames = [frame("f1"), frame("f2", { e1: { x: 500, content: "world" } }), frame("f3")];

  it("returns the base element before any override", () => {
    expect(resolveElementAt(base, frames, 0)).toEqual(base);
  });

  it("applies the override from its frame onward (sticky)", () => {
    expect(resolveElementAt(base, frames, 1).x).toBe(500);
    expect(resolveElementAt(base, frames, 1).content).toBe("world");
    expect(resolveElementAt(base, frames, 2).x).toBe(500); // carries forward
  });

  it("reverts deterministically when stepping backward", () => {
    expect(resolveElementAt(base, frames, 0).x).toBe(0);
    expect(resolveElementAt(base, frames, 0).content).toBe("hello");
  });

  it("lets a later override win and merges textStyle partially", () => {
    const fs = [frame("f1"), frame("f2", { e1: { textStyle: { color: "#f00" } } })];
    const r = resolveElementAt(base, fs, 1);
    expect(r.textStyle!.color).toBe("#f00");
    expect(r.textStyle!.fontSize).toBe(20); // untouched base value preserved
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `./resolve`.

- [ ] **Step 4: Write the implementation**

Create `src/playback/resolve.ts`:

```ts
// Effective element state at a frame index (design doc §4.2). Sticky: the most recent
// override at or before the current frame wins and carries forward. Deterministic and
// symmetric like visibility.ts, so stepping backward reverts. Mirrored in the export runtime.
import type { Element, ElementOverride, Frame } from "../types";

export function resolveElementAt(el: Element, frames: Frame[], currentIndex: number): Element {
  let ov: ElementOverride | undefined;
  const end = Math.min(currentIndex, frames.length - 1);
  for (let i = 0; i <= end; i++) {
    const o = frames[i].overrides?.[el.id];
    if (o) ov = o; // later frames overwrite earlier ones
  }
  if (!ov) return el;
  return {
    ...el,
    x: ov.x ?? el.x,
    y: ov.y ?? el.y,
    w: ov.w ?? el.w,
    h: ov.h ?? el.h,
    rotation: ov.rotation ?? el.rotation,
    content: ov.content ?? el.content,
    textStyle: ov.textStyle && el.textStyle ? { ...el.textStyle, ...ov.textStyle } : el.textStyle,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test`
Expected: all PASS.

- [ ] **Step 6: Add the store action**

In `src/store/store.ts`, add `ElementOverride` to the type import from `../types` (join it to the existing type import list). Add this signature to the actions interface, next to `reorderFrames` (line ~54):

```ts
  setFrameOverride: (frameId: string, elementId: string, patch: ElementOverride | null) => void;
```

And add the implementation next to `reorderFrames` (line ~229), following the existing immer `set` pattern:

```ts
      setFrameOverride: (frameId, elementId, patch) =>
        set((st) => {
          const f = st.presentation.frames.find((fr) => fr.id === frameId);
          if (!f) return;
          if (patch === null) {
            if (f.overrides) delete f.overrides[elementId];
          } else {
            if (!f.overrides) f.overrides = {};
            f.overrides[elementId] = { ...f.overrides[elementId], ...patch };
          }
        }),
```

- [ ] **Step 7: Typecheck, test, commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add src/types.ts src/playback/resolve.ts src/playback/resolve.test.ts src/store/store.ts
git commit -m "feat(magic-move): per-frame element overrides + sticky resolution"
```

---

### Task 13: Magic Move authoring UI (text content override) — Phase 2

**Files:**
- Modify: `src/components/PropertiesPanel.tsx` (`ElementProps`, add a Magic Move section)

**Interfaces:**
- Consumes: `setFrameOverride` from the store (Task 12); `currentFrameId`, `frames` already read in the panel.
- Produces: authored `overrides[elementId].content` on the current frame.

Scope: MVP authors the **text content** override only — the clearest Magic Move (a text box becomes different text at a later frame). Geometry authoring (moving an element per-frame on the canvas) needs the edit canvas to render per-frame resolved state and is deferred; geometry overrides set programmatically still morph in playback (Tasks 14–15).

- [ ] **Step 1: Add a Magic Move section to ElementProps**

In `src/components/PropertiesPanel.tsx`, inside `ElementProps`, read the extra store bits near the other hooks (after `const sendBackward = ...`):

```ts
  const currentFrameId = useStore((s) => s.currentFrameId);
  const frames2 = useStore((s) => s.presentation.frames);
  const setFrameOverride = useStore((s) => s.setFrameOverride);
```

Then, just before the closing `</>` of `ElementProps`'s returned fragment, add (text elements only, and only when a frame that isn't the element's entrance frame is current):

```tsx
      {el.type === "text" && currentFrameId && currentFrameId !== lc.enterAt && (
        <>
          <h3 style={{ marginTop: 14 }}>Magic Move (this frame)</h3>
          <div className="field">
            <label>Replace text from frame {frames2.findIndex((f) => f.id === currentFrameId) + 1}</label>
            <textarea
              rows={3}
              value={frames2.find((f) => f.id === currentFrameId)?.overrides?.[id]?.content ?? ""}
              placeholder="Leave empty for no change"
              onChange={(e) =>
                setFrameOverride(currentFrameId, id, e.target.value ? { content: e.target.value } : null)
              }
            />
          </div>
          <button
            onClick={() => setFrameOverride(currentFrameId, id, null)}
            disabled={!frames2.find((f) => f.id === currentFrameId)?.overrides?.[id]}
          >
            Clear Magic Move
          </button>
        </>
      )}
```

- [ ] **Step 2: Typecheck, test, verify**

Run: `npm run typecheck && npm run test`
Expected: PASS.

`npm run dev`: create a text element present from the start; capture two frames; select the element, navigate to frame 2, type replacement text in **Magic Move → Replace text**. The stored override is set (verify by exporting `.json` from the toolbar and confirming `frames[1].overrides` contains the element id, or re-selecting shows the textarea populated). "Clear Magic Move" removes it.

- [ ] **Step 3: Commit**

```bash
git add src/components/PropertiesPanel.tsx
git commit -m "feat(magic-move): author text-content overrides per frame"
```

---

### Task 14: Magic Move editor playback (resolved render + morph) — Phase 2

**Files:**
- Modify: `src/components/Stage.tsx` (render resolved elements)
- Modify: `src/components/ElementView.tsx` (`PlaybackElement`: `layout` morph + content crossfade)

**Interfaces:**
- Consumes: `resolveElementAt` (Task 12); `runViewTransition` (Task 11).
- Produces: correct per-frame render (hard requirement) + best-effort morph animation.

**Deliverable split:** the *hard requirement* is that Stage renders each element's resolved state at the current frame (so overrides are visible at all). The *morph animation* (geometry via Motion `layout`, content via crossfade) is best-effort and gated behind the Step 4 spike — if the camera-transform interaction misbehaves, ship the resolved render with an instant content swap and file the animated morph as follow-up. This is the one place the design's §4.3 tension is resolved empirically.

- [ ] **Step 1: Render resolved elements in Stage**

In `src/components/Stage.tsx`, add the import:

```ts
import { resolveElementAt } from "../playback/resolve";
```

In both branches (animated and static), compute the resolved element and pass it to `PlaybackElement`. For the animated branch:

```tsx
              const rel = resolveElementAt(el, presentation.frames, currentIndex);
              return (
                <PlaybackElement
                  key={el.id}
                  el={rel}
                  entering={v.entering}
                  leaving={v.leaving}
                  staggerIndex={order.get(el.id) ?? 0}
                />
              );
```

Apply the same `resolveElementAt` substitution in the static branch (`el={resolveElementAt(el, presentation.frames, currentIndex)}`). `enterOrder` and `visibilityAt` keep using the base `el` (lifecycle is not overridden).

- [ ] **Step 2: Add the `layout` prop for geometry morph**

In `src/components/ElementView.tsx`, in `PlaybackElement`, add `layout` and a `layoutId` to the `motion.div` so Motion FLIP-animates position/size changes between frames:

```tsx
    <motion.div
      className="element"
      layout
      layoutId={`el-${el.id}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
      initial={v.initial}
      animate={v.animate}
      exit={v.exit}
      transition={v.transition}
    >
```

- [ ] **Step 3: Crossfade content changes**

Still in `PlaybackElement`, detect a content change across renders and crossfade the body. Add near the top of the component:

```tsx
  const prevContent = useRef(el.content);
  useEffect(() => {
    if (prevContent.current !== el.content) {
      prevContent.current = el.content;
    }
  }, [el.content]);
```

Wrap the inner `ElementBody` so a content change animates opacity (keyed on content so React remounts and Motion crossfades):

```tsx
      <AnimatePresence mode="popLayout">
        <motion.div
          key={el.content}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, position: "absolute", inset: 0 }}
          transition={{ duration: 0.35 }}
          style={{ width: "100%", height: "100%" }}
        >
          <ElementBody el={el} editable={false} />
        </motion.div>
      </AnimatePresence>
```

(Add `AnimatePresence` and `useEffect`, `useRef` to the imports if not already present. This uses Motion's crossfade rather than `animateView` in-editor because the content sits inside the camera-transformed world where a page-level view transition would fight the camera — design doc §4.3.)

- [ ] **Step 4: Validation spike (REQUIRED before committing the animation)**

`npm run dev`: build a deck with (a) a text element that gets a content override at frame 2, and (b) an element whose override moves it (set geometry override via `.json` import or a temporary `setFrameOverride` call). Present and step across the override frame **with the camera staying roughly still**, then **with a large camera flight**.
Expected / decision:
- Content change crossfades smoothly → keep Step 3.
- Geometry `layout` morph animates cleanly when the camera is still → keep Step 2.
- If `layout` snaps, jitters, or fights the camera flight: remove the `layout`/`layoutId` props (Step 2 only), keep the resolved render + content crossfade, and note in the commit body that animated geometry morph is deferred (the resolved state still renders correctly, just without a tween). Do not block the task on it.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run typecheck && npm run test`
Expected: PASS (the pure tests are unaffected).

```bash
git add src/components/Stage.tsx src/components/ElementView.tsx
git commit -m "feat(magic-move): render resolved element state + morph in editor playback"
```

---

### Task 15: Magic Move in the export runtime (dependency-free) — Phase 2

**Files:**
- Modify: `src/export/runtime.ts` (mirror `resolveElementAt`; render resolved state; crossfade content + tween geometry on navigation)

**Interfaces:**
- Consumes: nothing new (plain-JS mirror of Task 12; must stay dependency-free per Global Constraints and design doc §4.4).
- Produces: exported files play Magic Move overrides.

Approach (design doc §4.4): no View Transitions API, no Motion. Mirror the sticky resolver in vanilla JS; on each `render(i)`, apply the resolved geometry to each node (WAAPI-tween `left/top/width/height` from the previous values) and, when `content` changed, opacity-crossfade a temporary clone over the node.

- [ ] **Step 1: Mirror the resolver in the runtime string**

In `src/export/runtime.ts`, inside the template, add next to `visAt` (after line ~95):

```js
  function resolveAt(el,i){
    var ov=null;
    for(var j=0;j<=i&&j<frames.length;j++){ var o=frames[j].overrides&&frames[j].overrides[el.id]; if(o) ov=o; }
    if(!ov) return el;
    return {id:el.id,type:el.type,z:el.z,rotation:(ov.rotation!=null?ov.rotation:el.rotation),
      x:(ov.x!=null?ov.x:el.x),y:(ov.y!=null?ov.y:el.y),w:(ov.w!=null?ov.w:el.w),h:(ov.h!=null?ov.h:el.h),
      content:(ov.content!=null?ov.content:el.content),textStyle:el.textStyle,lifecycle:el.lifecycle};
  }
```

- [ ] **Step 2: Apply resolved geometry + content crossfade in render()**

Extend the runtime `render(i)` so that, for each currently-visible element, it applies the resolved state to the node, tweening geometry and crossfading content when they change from the node's last-applied values. Store per-node last state on the node object (`node.__st`). Replace the visible-node handling inside `render` with:

```js
      if(on){
        node.style.display='';
        var r=resolveAt(el,i), st=node.__st||{x:el.x,y:el.y,w:el.w,h:el.h,content:el.content};
        // geometry tween
        if(!reduced && (st.x!==r.x||st.y!==r.y||st.w!==r.w||st.h!==r.h)){
          node.animate([{left:st.x+'px',top:st.y+'px',width:st.w+'px',height:st.h+'px'},
                        {left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'}],
                       {duration:450,easing:'ease',fill:'backwards'});
        }
        node.style.left=r.x+'px'; node.style.top=r.y+'px'; node.style.width=r.w+'px'; node.style.height=r.h+'px';
        // content crossfade (text only for MVP; media swaps src instantly)
        if(st.content!==r.content){
          var inner=node.firstChild;
          if(el.type==='text'){
            if(!reduced){ var ghost=inner.cloneNode(true); ghost.style.position='absolute'; ghost.style.inset='0';
              node.appendChild(ghost); ghost.animate([{opacity:1},{opacity:0}],{duration:350}).onfinish=function(){ghost.remove();}; }
            inner.innerHTML=r.content;
            if(!reduced) inner.animate([{opacity:0},{opacity:1}],{duration:350});
          } else { var im=inner.firstChild; if(im) im.src=r.content; }
        }
        node.__st={x:r.x,y:r.y,w:r.w,h:r.h,content:r.content};
        if(!wasOn){ var lc=el.lifecycle||{}; if(lc.enterAt&&idxOf(lc.enterAt)===i){ entrance(el,node,(k++)*60); } }
      }
```

(Keep the existing `else if(!on&&wasOn){ exit(el,node); }` branch. Note this replaces the earlier `if(on&&!wasOn)` block from Task 4 — the entrance call is now nested inside the `if(on)` branch guarded by `!wasOn`, preserving Task 4's stagger behavior.)

- [ ] **Step 3: Typecheck, test, build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Manual verification of an exported file**

`npm run dev` → build the Task 13/14 Magic Move deck → **Export .html** → open it → step across the override frame.
Expected: text content crossfades and any geometry override tweens to its new box; stepping backward reverts. View source and confirm the runtime script has no `import`, no external URL, and no reference to `animateView`/`startViewTransition` (design doc §4.4 / D8.3).

- [ ] **Step 5: Commit**

```bash
git add src/export/runtime.ts
git commit -m "feat(magic-move): play per-frame overrides in exported runtime (dependency-free)"
```

---

### Task 16: User manual + full verification pass

**Files:**
- Modify: `docs/USER_MANUAL.md:140` (section "6. Element entrance & exit")

**Interfaces:**
- Consumes: everything above (whichever phases shipped).
- Produces: done.

- [ ] **Step 1: Update the manual**

In `docs/USER_MANUAL.md`, change:

```markdown
- **Entrance effect** — `none`, `appear`, `fade`, `slide` (choose a direction), or `pulse`
  (a draw-attention beat).
```

to:

```markdown
- **Entrance effect** — `none`, `appear`, `fade`, `slide` (choose a direction), `pulse`
  (a draw-attention beat), or `spring` (a bouncy scale-up pop).
```

And after the "Visibility is fully deterministic…" paragraph (ending "…rehearse in any direction."), add:

```markdown
When several elements enter at the **same frame**, their effects ripple in automatically —
each starts 60 ms after the one behind it (back-to-front by stacking order) instead of all
firing at once. There is nothing to configure; it also works in exported files.
```

If Phase 2 (Magic Move, Tasks 12–15) shipped, also add a new subsection after section 6:

```markdown
## 6a. Magic Move (per-frame changes)

Give an element a new value at a later frame and it *morphs* into it instead of cutting.
With a text element selected and a later frame current, open **Magic Move (this frame)** in
Properties and type replacement text — when you navigate into that frame the old text
crossfades into the new. Overrides are sticky (they carry forward) and revert when you step
back. This also plays in exported files.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS.

Then one end-to-end pass in `npm run dev`, covering whatever shipped:
- **Phase 1:** a deck exercising stagger + spring entrances, a properties-panel selection swap (click element ↔ empty canvas), an edit↔present crossfade (Present / Esc), and a timeline reorder. Present it, export it, and play the exported file.
- **Phase 2 (if built):** add a text Magic Move override and confirm it crossfades in both the editor and the exported file.
- **Reduced motion:** enable OS reduced-motion and confirm every new animation collapses to instant with no console errors.

- [ ] **Step 3: Commit**

```bash
git add docs/USER_MANUAL.md
git commit -m "docs: document spring entrance, stagger, and Magic Move"
```
