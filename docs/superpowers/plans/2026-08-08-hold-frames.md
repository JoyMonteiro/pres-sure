# Hold Frames & Sequential Reveals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let elements appear one after another in place — bullet lists, image sequences — by adding "hold" frames that borrow the preceding shot's camera, plus the multi-select and authoring action that build them in one click.

**Architecture:** A hold is an ordinary frame carrying `kind: "hold"`; it has no camera of its own and resolves at read time to the nearest preceding shot. Because a hold is still a plain frame index, `visibility.ts`, `stagger.ts` and `lifecycle.enterAt` are untouched, and the export runtime never learns holds exist — `exportHtml` flattens them into concrete rects before serializing. All new logic lands in one pure module, `src/playback/holds.ts`, consumed by the store and UI.

**Tech Stack:** React + TypeScript + Vite, Zustand + immer + zundo, Motion, vitest (no jsdom — pure tests only).

See `docs/superpowers/specs/2026-08-08-hold-frames-design.md` for rationale.

## Global Constraints

- **`src/export/runtime.ts` must not be modified by this plan.** Export parity is achieved by flattening data at build time (spec D4). If you find yourself editing the runtime, the flatten step is wrong.
- **`src/playback/visibility.test.ts` and `src/playback/stagger.test.ts` must pass unmodified** at every commit. They are the evidence the playback model did not shift (spec §8).
- **`kind` is optional and absent means `"shot"`.** Never write `kind: "shot"` into stored data, and never require it when reading — existing IndexedDB saves, exported JSON and templates have no `kind` at all (spec D3).
- **No jsdom.** `npm test` is `vitest run` with no DOM environment. Every function that needs a test must be pure and importable without React.
- **Impurity stays out of `holds.ts`.** It must not import `store/factory.ts` (`uid()` uses `Math.random()`/`Date.now()`). Functions needing new frames take a factory callback.
- Run `npm run typecheck` before every commit.

---

### Task 1: Hold frame type, factory, and camera resolver

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/factory.ts`
- Create: `src/playback/holds.ts`
- Test: `src/playback/holds.test.ts`

**Interfaces:**
- Consumes: `Frame` from `src/types.ts`; `Rect` from `src/camera/camera.ts`.
- Produces:
  - `type FrameKind = "shot" | "hold"`, `Frame.kind?: FrameKind`
  - `makeHold(partial?: Partial<Frame>): Frame`
  - `isHold(f: Frame): boolean`
  - `resolveFrameRect(frames: Frame[], i: number): Rect | null`
  - `interface HoldGroup { shot: Frame; holds: Frame[]; startIndex: number }`
  - `holdGroups(frames: Frame[]): HoldGroup[]`

- [ ] **Step 1: Add the `kind` field to `Frame`**

In `src/types.ts`, add above `export interface Frame`:

```ts
/** "shot" carries its own camera; "hold" borrows the preceding shot's (see spec D3). */
export type FrameKind = "shot" | "hold";
```

and add this field to `Frame`, after `notes: string;`:

```ts
  /**
   * A "hold" is a reveal step: it has no camera of its own and resolves to the nearest
   * preceding shot. Absent means "shot" — never write "shot" into stored data, so old
   * saves stay loadable without migration.
   */
  kind?: FrameKind;
```

- [ ] **Step 2: Add the `makeHold` factory**

In `src/store/factory.ts`, add after `makeFrame`:

```ts
/**
 * A reveal step. Geometry is a placeholder — `resolveFrameRect` supplies the real rect —
 * but w/h stay non-zero so nothing that divides by them can produce Infinity.
 */
export function makeHold(partial: Partial<Frame> = {}): Frame {
  return {
    ...makeFrame({ x: 0, y: 0, w: 1, h: 1, title: "Step", ...partial }),
    kind: "hold",
    easing: "cut",
    duration: 0,
  };
}
```

The invariant fields come after `...partial` on purpose: a caller can set the title but cannot accidentally produce a hold that animates.

- [ ] **Step 3: Write the failing test**

Create `src/playback/holds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { holdGroups, isHold, resolveFrameRect } from "./holds";
import type { Frame } from "../types";

const shot = (id: string, x = 0, rotation = 0): Frame => ({
  id,
  title: id,
  x,
  y: 0,
  w: 100,
  h: 100,
  rotation,
  duration: "auto",
  easing: "smooth",
  notes: "",
});

const hold = (id: string): Frame => ({
  ...shot(id, 999),
  kind: "hold",
  easing: "cut",
  duration: 0,
});

describe("isHold", () => {
  it("treats a frame with no kind as a shot", () => {
    expect(isHold(shot("f1"))).toBe(false);
    expect(isHold(hold("h1"))).toBe(true);
  });
});

describe("resolveFrameRect", () => {
  it("returns a shot's own rect", () => {
    const frames = [shot("f1", 10)];
    expect(resolveFrameRect(frames, 0)).toEqual({ x: 10, y: 0, w: 100, h: 100, rotation: 0 });
  });

  it("resolves a hold to the preceding shot, ignoring the hold's own geometry", () => {
    const frames = [shot("f1", 10), hold("h1")];
    expect(resolveFrameRect(frames, 1)).toEqual({ x: 10, y: 0, w: 100, h: 100, rotation: 0 });
  });

  it("resolves consecutive holds to the same shot", () => {
    const frames = [shot("f1", 10), hold("h1"), hold("h2"), hold("h3")];
    expect(resolveFrameRect(frames, 3)).toEqual(resolveFrameRect(frames, 1));
  });

  it("carries the shot's rotation", () => {
    const frames = [shot("f1", 10, 45), hold("h1")];
    expect(resolveFrameRect(frames, 1)!.rotation).toBe(45);
  });

  it("resolves a shot after a build to itself, not to the earlier shot", () => {
    const frames = [shot("f1", 10), hold("h1"), shot("f2", 20)];
    expect(resolveFrameRect(frames, 2)!.x).toBe(20);
  });

  it("falls back to the first shot for a leading hold", () => {
    const frames = [hold("h1"), shot("f1", 10)];
    expect(resolveFrameRect(frames, 0)!.x).toBe(10);
  });

  it("returns null for an out-of-range index", () => {
    expect(resolveFrameRect([shot("f1")], 5)).toBeNull();
  });
});

describe("holdGroups", () => {
  it("attaches trailing holds to their shot", () => {
    const frames = [shot("f1"), hold("h1"), hold("h2"), shot("f2"), hold("h3")];
    const groups = holdGroups(frames);
    expect(groups.map((g) => g.shot.id)).toEqual(["f1", "f2"]);
    expect(groups[0].holds.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(groups[1].holds.map((h) => h.id)).toEqual(["h3"]);
  });

  it("reports the flat index of each shot", () => {
    const frames = [shot("f1"), hold("h1"), shot("f2")];
    expect(holdGroups(frames).map((g) => g.startIndex)).toEqual([0, 2]);
  });

  it("never drops a leading hold — it becomes its own group", () => {
    const frames = [hold("h1"), shot("f1")];
    const groups = holdGroups(frames);
    expect(groups.flatMap((g) => [g.shot.id, ...g.holds.map((h) => h.id)])).toEqual(["h1", "f1"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/playback/holds.test.ts`
Expected: FAIL — cannot resolve `./holds`.

- [ ] **Step 5: Write the implementation**

Create `src/playback/holds.ts`:

```ts
// Hold frames — reveal steps that borrow the preceding shot's camera (spec D2/D3 in
// docs/superpowers/specs/2026-08-08-hold-frames-design.md).
//
// Pure and index-based, exactly like visibility.ts and stagger.ts: a hold is still an
// ordinary frame index, which is why lifecycle/visibility/stagger need no changes at all.
// Must not import store/factory.ts — id generation is impure and would break these tests.
import type { Rect } from "../camera/camera";
import type { Frame } from "../types";

export interface HoldGroup {
  shot: Frame;
  holds: Frame[];
  /** Flat index of `shot` in the frames array. */
  startIndex: number;
}

/** Absent `kind` means "shot", so old saves read correctly. */
export const isHold = (f: Frame): boolean => f.kind === "hold";

const rectOf = (f: Frame): Rect => ({ x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation });

/**
 * Effective camera rect at index `i`. A hold resolves to the nearest preceding shot; a
 * leading hold (which the reorder rules prevent) falls back to the first shot in the list.
 */
export function resolveFrameRect(frames: Frame[], i: number): Rect | null {
  const f = frames[i];
  if (!f) return null;
  if (!isHold(f)) return rectOf(f);
  for (let j = i - 1; j >= 0; j--) {
    if (!isHold(frames[j])) return rectOf(frames[j]);
  }
  return rectOf(frames.find((x) => !isHold(x)) ?? f);
}

/**
 * Shots with their trailing holds, for timeline rendering. A leading hold becomes its own
 * group rather than being dropped — a frame the timeline never draws would still consume a
 * click during playback.
 */
export function holdGroups(frames: Frame[]): HoldGroup[] {
  const groups: HoldGroup[] = [];
  frames.forEach((f, i) => {
    if (!isHold(f) || groups.length === 0) groups.push({ shot: f, holds: [], startIndex: i });
    else groups[groups.length - 1].holds.push(f);
  });
  return groups;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test`
Expected: PASS, including the untouched `visibility.test.ts` and `stagger.test.ts`.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store/factory.ts src/playback/holds.ts src/playback/holds.test.ts
git commit -m "feat: add hold frame type, factory and camera resolver"
```

---

### Task 2: `planReveal` — the build-authoring computation

**Files:**
- Modify: `src/playback/holds.ts`
- Test: `src/playback/holds.test.ts`

**Interfaces:**
- Consumes: `isHold` from Task 1.
- Produces:
  - `interface RevealPlan { holds: Frame[]; assignments: Map<string, string>; insertAt: number }`
  - `planReveal(frames, elementIds, currentFrameId, makeHoldFrame): RevealPlan | null`
    where `makeHoldFrame: (title: string) => Frame`.

The factory arrives as a callback so `holds.ts` stays pure and testable — the test passes a deterministic stub, the store passes `makeHold`.

- [ ] **Step 1: Write the failing test**

Append to `src/playback/holds.test.ts`:

```ts
import { planReveal } from "./holds";

// Deterministic stand-in for makeHold — keeps the test free of random ids.
let holdSeq = 0;
const stubHold = (title: string): Frame => ({ ...hold(`stub${++holdSeq}`), title });

describe("planReveal", () => {
  it("gives the first element the anchor frame and each other its own hold", () => {
    holdSeq = 0;
    const frames = [shot("f1"), shot("f2")];
    const plan = planReveal(frames, ["a", "b", "c"], "f1", stubHold)!;

    expect(plan.holds).toHaveLength(2);
    expect(plan.assignments.get("a")).toBe("f1");
    expect(plan.assignments.get("b")).toBe(plan.holds[0].id);
    expect(plan.assignments.get("c")).toBe(plan.holds[1].id);
  });

  it("preserves click order rather than sorting", () => {
    holdSeq = 0;
    const frames = [shot("f1")];
    const plan = planReveal(frames, ["c", "a", "b"], "f1", stubHold)!;
    expect(plan.assignments.get("c")).toBe("f1");
    expect(plan.assignments.get("a")).toBe(plan.holds[0].id);
  });

  it("titles the new steps from 2 upward", () => {
    holdSeq = 0;
    const plan = planReveal([shot("f1")], ["a", "b", "c"], "f1", stubHold)!;
    expect(plan.holds.map((h) => h.title)).toEqual(["Step 2", "Step 3"]);
  });

  it("inserts directly after the anchor shot when it has no holds yet", () => {
    holdSeq = 0;
    const frames = [shot("f1"), shot("f2")];
    expect(planReveal(frames, ["a", "b"], "f1", stubHold)!.insertAt).toBe(1);
  });

  it("inserts after the anchor's existing holds, not between them", () => {
    holdSeq = 0;
    const frames = [shot("f1"), hold("h1"), hold("h2"), shot("f2")];
    expect(planReveal(frames, ["a", "b"], "f1", stubHold)!.insertAt).toBe(3);
  });

  it("accepts a hold as the anchor and still appends to the end of its group", () => {
    holdSeq = 0;
    const frames = [shot("f1"), hold("h1"), hold("h2"), shot("f2")];
    const plan = planReveal(frames, ["a", "b"], "h1", stubHold)!;
    expect(plan.insertAt).toBe(3);
    expect(plan.assignments.get("a")).toBe("h1");
  });

  it("returns null when there is nothing to build", () => {
    expect(planReveal([shot("f1")], ["a"], "f1", stubHold)).toBeNull();
    expect(planReveal([shot("f1")], ["a", "b"], null, stubHold)).toBeNull();
    expect(planReveal([shot("f1")], ["a", "b"], "nope", stubHold)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/playback/holds.test.ts`
Expected: FAIL — `planReveal` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/playback/holds.ts`:

```ts
export interface RevealPlan {
  /** Holds to insert, in order, at `insertAt`. */
  holds: Frame[];
  /** element id -> the frame id its `lifecycle.enterAt` should point at. */
  assignments: Map<string, string>;
  /** Flat index at which `holds` are spliced in. */
  insertAt: number;
}

/**
 * Turn an ordered selection into a build. The anchor is whatever frame `currentFrameId`
 * names — shot or hold — and the first element is assigned to it, so N elements cost N-1
 * new steps. New holds land at the end of the anchor's group so a second build appends to
 * the first rather than interleaving with it.
 *
 * `makeHoldFrame` is injected to keep this function pure (see the module header).
 */
export function planReveal(
  frames: Frame[],
  elementIds: string[],
  currentFrameId: string | null,
  makeHoldFrame: (title: string) => Frame
): RevealPlan | null {
  if (elementIds.length < 2 || !currentFrameId) return null;
  const anchorIdx = frames.findIndex((f) => f.id === currentFrameId);
  if (anchorIdx < 0) return null;

  let end = anchorIdx;
  while (end + 1 < frames.length && isHold(frames[end + 1])) end++;

  const rest = elementIds.slice(1);
  const holds = rest.map((_, k) => makeHoldFrame(`Step ${k + 2}`));

  const assignments = new Map<string, string>();
  assignments.set(elementIds[0], currentFrameId);
  rest.forEach((id, k) => assignments.set(id, holds[k].id));

  return { holds, assignments, insertAt: end + 1 };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/playback/holds.ts src/playback/holds.test.ts
git commit -m "feat: add planReveal build-authoring computation"
```

---

### Task 3: Export flattening (runtime stays untouched)

**Files:**
- Modify: `src/playback/holds.ts`
- Modify: `src/export/exportHtml.ts`
- Test: `src/playback/holds.test.ts`

**Interfaces:**
- Consumes: `isHold`, `resolveFrameRect` from Task 1.
- Produces: `flattenFrames(frames: Frame[]): Frame[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/playback/holds.test.ts`:

```ts
import { flattenFrames } from "./holds";

describe("flattenFrames", () => {
  it("gives each hold its shot's rect", () => {
    const flat = flattenFrames([shot("f1", 10), hold("h1")]);
    expect(flat[1].x).toBe(10);
    expect(flat[1].w).toBe(100);
  });

  it("strips kind so the exported runtime never sees a hold", () => {
    const flat = flattenFrames([shot("f1"), hold("h1")]);
    expect(flat.every((f) => f.kind === undefined)).toBe(true);
  });

  it("forces holds to cut with zero duration", () => {
    const flat = flattenFrames([shot("f1"), hold("h1")]);
    expect(flat[1].easing).toBe("cut");
    expect(flat[1].duration).toBe(0);
  });

  it("leaves shots exactly as they were", () => {
    const frames = [shot("f1", 10), hold("h1"), shot("f2", 20)];
    const flat = flattenFrames(frames);
    expect(flat[0]).toEqual(frames[0]);
    expect(flat[2]).toEqual(frames[2]);
  });

  it("preserves frame count and order, so indices still line up with enterAt", () => {
    const frames = [shot("f1"), hold("h1"), hold("h2"), shot("f2")];
    expect(flattenFrames(frames).map((f) => f.id)).toEqual(["f1", "h1", "h2", "f2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/playback/holds.test.ts`
Expected: FAIL — `flattenFrames` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/playback/holds.ts`:

```ts
/**
 * Frames with holds resolved to real rects, forced to cut, and `kind` stripped. This is
 * the whole of export parity: the exported runtime receives ordinary frames and needs no
 * knowledge of holds (spec D4). Order and count are preserved, so `enterAt` indices hold.
 */
export function flattenFrames(frames: Frame[]): Frame[] {
  return frames.map((f, i) => {
    if (!isHold(f)) return f;
    const flat: Frame = { ...f, ...resolveFrameRect(frames, i)!, easing: "cut", duration: 0 };
    delete flat.kind; // `delete` rather than rest-destructuring: tsconfig sets noUnusedLocals
    return flat;
  });
}
```

- [ ] **Step 4: Wire it into the export**

In `src/export/exportHtml.ts`, add the import:

```ts
import { flattenFrames } from "../playback/holds";
```

and replace the first line of `buildHtml`:

```ts
  const data = JSON.stringify(p).replace(/</g, "\\u003c");
```

with:

```ts
  // Holds are resolved here, so the runtime only ever sees ordinary frames (spec D4).
  const flat = { ...p, frames: flattenFrames(p.frames) };
  const data = JSON.stringify(flat).replace(/</g, "\\u003c");
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no errors.

Confirm `src/export/runtime.ts` shows no diff:

Run: `git diff --stat src/export/runtime.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/playback/holds.ts src/playback/holds.test.ts src/export/exportHtml.ts
git commit -m "feat: flatten hold frames at export time"
```

---

### Task 4: Store actions

**Files:**
- Modify: `src/store/store.ts`

**Interfaces:**
- Consumes: `makeHold` (Task 1); `holdGroups`, `isHold`, `planReveal` (Tasks 1–2).
- Produces, on `AppState`:
  - `toggleSelect: (id: string) => void`
  - `revealOneAtATime: () => void`
  - `addHoldStep: (shotId: string) => void`
  - `moveFrameGroup: (from: number, to: number) => void` — **replaces** `reorderFrames`
  - `removeFrame` gains cascade behaviour

There are no tests in this task: the store is not testable under a jsdom-free vitest, which is exactly why Tasks 1–3 pushed every decision into pure functions. These actions are thin wrappers over already-tested logic.

- [ ] **Step 1: Add the imports**

In `src/store/store.ts`, extend the factory import and add the holds import:

```ts
import { makeElement, makeFrame, makeHold, makePresentation } from "./factory";
import { holdGroups, isHold, planReveal } from "../playback/holds";
```

- [ ] **Step 2: Update the `AppState` interface**

Replace this line:

```ts
  reorderFrames: (from: number, to: number) => void;
```

with:

```ts
  /** Reorder whole groups (a shot plus its holds), by group index — not flat frame index. */
  moveFrameGroup: (from: number, to: number) => void;
  addHoldStep: (shotId: string) => void;
```

and add to the transient setters block, under `select`:

```ts
  /** Add/remove one id, preserving click order — the order a build reveals in. */
  toggleSelect: (id: string) => void;
```

- [ ] **Step 3: Implement `toggleSelect`**

Add after the `select` implementation:

```ts
      toggleSelect: (id) =>
        set((st) => {
          const i = st.selectedIds.indexOf(id);
          if (i >= 0) st.selectedIds.splice(i, 1);
          else st.selectedIds.push(id); // append: selection order is the reveal order
        }),
```

- [ ] **Step 4: Replace `reorderFrames` with `moveFrameGroup`**

Delete the whole `reorderFrames` implementation and add in its place:

```ts
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
```

- [ ] **Step 5: Implement `addHoldStep`**

Add after `duplicateFrame`:

```ts
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
```

- [ ] **Step 6: Implement `revealOneAtATime`**

Add after `addHoldStep`:

```ts
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
```

Add its declaration to `AppState`, next to `addHoldStep`:

```ts
  revealOneAtATime: () => void;
```

- [ ] **Step 7: Add the delete cascade to `removeFrame`**

Replace the whole `removeFrame` implementation with:

```ts
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
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: exactly one class of error — `Timeline.tsx` still calls the now-deleted `reorderFrames`. Task 7 fixes it. If you see any other error, fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add src/store/store.ts
git commit -m "feat: add hold-step and multi-select store actions"
```

---

### Task 5: Shift-click multi-select with ordinal badges

**Files:**
- Modify: `src/components/ElementView.tsx:26-56`
- Modify: `src/components/EditCanvas.tsx:86-89`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `toggleSelect` (Task 4).
- Produces: `EditableElement` gains `selectionIndex?: number` — 1-based position in the selection, `0`/absent meaning "don't show a badge".

- [ ] **Step 1: Add the modifier branch and the badge to `EditableElement`**

In `src/components/ElementView.tsx`, change the component signature:

```tsx
export function EditableElement({
  el,
  scale,
  selected,
  selectionIndex = 0,
}: {
  el: Element;
  scale: number;
  selected: boolean;
  selectionIndex?: number;
}) {
  const update = useStore((s) => s.updateElement);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const setGuides = useStore((s) => s.setGuides);
```

Change `onMouseDown`:

```tsx
      onMouseDown={(e) => {
        e.stopPropagation();
        // Shift/meta extends the selection; order is preserved because toggleSelect
        // appends, and that order is what a build reveals in.
        if (e.shiftKey || e.metaKey) toggleSelect(el.id);
        else select([el.id]);
      }}
```

Add the badge inside the `.content` div, before the blur hint:

```tsx
        {selectionIndex > 0 && <div className="sel-ordinal">{selectionIndex}</div>}
```

- [ ] **Step 2: Pass the ordinal from the canvas**

In `src/components/EditCanvas.tsx`, replace the element map:

```tsx
        {sorted.map((el) => (
          <EditableElement
            key={el.id}
            el={el}
            scale={cam.scale}
            selected={selectedIds.includes(el.id)}
            // Only meaningful for a multi-selection — one selected element needs no number.
            selectionIndex={selectedIds.length > 1 ? selectedIds.indexOf(el.id) + 1 : 0}
          />
        ))}
```

- [ ] **Step 3: Style the badge**

In `src/styles.css`, add after the `.blur-hint` rule:

```css
.sel-ordinal {
  position: absolute; top: -10px; left: -10px; z-index: 5;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--accent); color: #fff; font-size: 11px; font-weight: 700;
  display: grid; place-items: center; pointer-events: none;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: only the known `Timeline.tsx` / `reorderFrames` error from Task 4.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`

1. Add three text elements.
2. Click the first — it selects alone, no badge.
3. Shift-click the second and third — all three show outlines, badged 1, 2, 3 in click order.
4. Shift-click the second again — it deselects, and the third renumbers to 2.
5. Click an empty area of the canvas — the selection clears.

- [ ] **Step 6: Commit**

```bash
git add src/components/ElementView.tsx src/components/EditCanvas.tsx src/styles.css
git commit -m "feat: shift-click multi-select with ordinal badges"
```

---

### Task 6: Properties panel — build action and hold frame props

**Files:**
- Modify: `src/components/PropertiesPanel.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `revealOneAtATime` (Task 4); `holdGroups`, `isHold` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add imports**

In `src/components/PropertiesPanel.tsx`, add the holds import and extend the existing type
import (do not add a second `import type` from `"../types"`):

```ts
import { holdGroups, isHold } from "../playback/holds";
import type { Element, EnterEffect, ExitEffect, SlideDirection } from "../types";
```

- [ ] **Step 2: Add the third branch**

Replace this line in `PropertiesPanel`:

```tsx
      {sel ? <ElementProps id={sel.id} /> : <FrameProps id={currentFrameId} />}
```

with:

```tsx
      {sel ? (
        <ElementProps id={sel.id} />
      ) : selectedIds.length > 1 ? (
        <MultiElementProps />
      ) : (
        <FrameProps id={currentFrameId} />
      )}
```

- [ ] **Step 3: Add the `MultiElementProps` component**

Add at the end of the file:

```tsx
/** Shown for a 2+ element selection: the reveal builder (spec §5). */
function MultiElementProps() {
  const selectedIds = useStore((s) => s.selectedIds);
  const elements = useStore((s) => s.presentation.elements);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const frames = useStore((s) => s.presentation.frames);
  const reveal = useStore((s) => s.revealOneAtATime);

  const chosen = selectedIds
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is Element => !!e);
  const anchor = frames.find((f) => f.id === currentFrameId);

  return (
    <>
      <h3>{chosen.length} elements selected</h3>
      <ol className="sel-list">
        {chosen.map((e, i) => (
          <li key={e.id}>
            <span className="idx">{i + 1}</span> {elementLabel(e)}
          </li>
        ))}
      </ol>
      <button style={{ width: "100%" }} disabled={!anchor} onClick={() => reveal()}>
        Reveal one at a time
      </button>
      <p className="hint">
        {anchor
          ? `Element 1 appears with “${anchor.title}”; each of the others gets its own step. Existing entrance frames are overwritten.`
          : "Select a frame in the timeline first."}
      </p>
    </>
  );
}

/** Short human label for the selection list — text content, or just the type. */
function elementLabel(e: Element): string {
  if (e.type !== "text") return e.type;
  const plain = e.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "text";
  return plain.length > 28 ? `${plain.slice(0, 28)}…` : plain;
}
```

- [ ] **Step 4: Give holds their own frame properties**

In `FrameProps`, insert immediately after the `if (!frame) return ...` line:

```tsx
  if (isHold(frame)) {
    // A hold has no camera move, so transition feel, duration and re-capture are all
    // meaningless for it — only its title and notes are editable.
    const group = holdGroups(frames).find((g) => g.holds.some((h) => h.id === frame.id));
    return (
      <>
        <h3>Reveal step</h3>
        <div className="field">
          <label>Title</label>
          <input value={frame.title} onChange={(e) => update(frame.id, { title: e.target.value })} />
        </div>
        <div className="field">
          <label>Speaker notes</label>
          <textarea rows={5} value={frame.notes} onChange={(e) => update(frame.id, { notes: e.target.value })} />
        </div>
        <p className="hint">
          Camera inherited from “{group?.shot.title ?? "the preceding frame"}”. Advancing to this
          step reveals its elements without moving the camera.
        </p>
      </>
    );
  }
```

`FrameProps` needs `frames` for that lookup — add at the top of the component, next to the existing hooks:

```tsx
  const frames = useStore((s) => s.presentation.frames);
```

- [ ] **Step 5: Style the selection list**

In `src/styles.css`, add after the `.field` rules:

```css
.sel-list { list-style: none; margin: 0 0 10px; padding: 0; font-size: 12px; }
.sel-list li { display: flex; gap: 6px; align-items: center; padding: 2px 0; color: var(--text); }
.sel-list .idx {
  flex: 0 0 auto; min-width: 16px; height: 16px; border-radius: 8px;
  background: var(--accent); color: #fff; font-size: 10px; font-weight: 700;
  display: grid; place-items: center;
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the known `Timeline.tsx` / `reorderFrames` error.

- [ ] **Step 7: Commit**

```bash
git add src/components/PropertiesPanel.tsx src/styles.css
git commit -m "feat: reveal builder and hold frame properties panel"
```

---

### Task 7: Timeline groups, ticks and group drag

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `holdGroups` (Task 1); `resolveFrameRect` (Task 1); `moveFrameGroup`, `addHoldStep` (Task 4).
- Produces: nothing other tasks depend on. This task clears the `reorderFrames` typecheck error from Task 4.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/Timeline.tsx`:

```tsx
import { useRef, useState } from "react";
import { useStore } from "../store/store";
import { frameToCamera } from "../camera/camera";
import { holdGroups, resolveFrameRect } from "../playback/holds";
import { useCameraTo } from "../playback/useCameraTo";
import { Thumbnail } from "./Thumbnail";

export function Timeline() {
  const frames = useStore((s) => s.presentation.frames);
  const presentation = useStore((s) => s.presentation);
  const currentFrameId = useStore((s) => s.currentFrameId);
  const viewport = useStore((s) => s.viewport);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const captureFrame = useStore((s) => s.captureFrame);
  const frameToSelection = useStore((s) => s.frameToSelection);
  const duplicateFrame = useStore((s) => s.duplicateFrame);
  const removeFrame = useStore((s) => s.removeFrame);
  const moveFrameGroup = useStore((s) => s.moveFrameGroup);
  const addHoldStep = useStore((s) => s.addHoldStep);
  const updateFrame = useStore((s) => s.updateFrame);
  const selectedCount = useStore((s) => s.selectedIds.length);
  const cameraTo = useCameraTo();

  const dragIdx = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const groups = holdGroups(frames);

  // Index is needed as well as id: a hold's camera comes from its position in the list.
  const goTo = (id: string, index: number) => {
    const f = frames[index];
    const rect = resolveFrameRect(frames, index);
    if (!f || !rect) return;
    setCurrentFrame(id);
    cameraTo(frameToCamera(rect, viewport), f.easing, f.duration);
  };

  return (
    <div className="timeline">
      <div className="timeline-head">
        <strong style={{ fontSize: 13 }}>Timeline</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {groups.length} shots · {frames.length} steps
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => captureFrame()} title="Capture the current view as a frame">
          + Frame from view
        </button>
        <button
          onClick={() => frameToSelection()}
          disabled={selectedCount === 0}
          title="Fit a frame to the selected elements"
        >
          + Frame selection
        </button>
      </div>
      <div className="timeline-strip">
        {groups.map((g, gi) => (
          <div
            className="frame-group"
            key={g.shot.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx.current !== null && dragIdx.current !== gi) moveFrameGroup(dragIdx.current, gi);
              dragIdx.current = null;
              setDragging(null);
            }}
          >
            <div
              className={`frame-card${g.shot.id === currentFrameId ? " current" : ""}${
                dragging === gi ? " dragging" : ""
              }`}
              draggable
              onDragStart={() => {
                dragIdx.current = gi;
                setDragging(gi);
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => goTo(g.shot.id, g.startIndex)}
            >
              <Thumbnail presentation={presentation} frame={g.shot} index={g.startIndex} />
              <div className="frame-meta">
                <span className="idx">{gi + 1}</span>
                <input
                  value={g.shot.title}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateFrame(g.shot.id, { title: e.target.value })}
                />
              </div>
              <div className="row">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateFrame(g.shot.id);
                  }}
                >
                  Dup
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFrame(g.shot.id);
                  }}
                  title="Delete this shot and its reveal steps"
                >
                  Del
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addHoldStep(g.shot.id);
                  }}
                  title="Add a reveal step that keeps this camera"
                >
                  + Step
                </button>
              </div>
            </div>
            {g.holds.map((h, hi) => (
              <div
                key={h.id}
                className={`hold-tick${h.id === currentFrameId ? " current" : ""}`}
                title={`${h.title} — same camera as “${g.shot.title}”`}
                onClick={() => goTo(h.id, g.startIndex + 1 + hi)}
              >
                <span className="tick-idx">{hi + 2}</span>
                <button
                  className="tick-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFrame(h.id);
                  }}
                  title="Delete this step"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}
        {frames.length === 0 && (
          <div style={{ color: "var(--muted)", alignSelf: "center", padding: "0 12px" }}>
            Pan/zoom the canvas, then press <span className="kbd">+ Frame from view</span> to capture your first shot.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Style groups and ticks**

In `src/styles.css`, add after the `.frame-card .row button` rule:

```css
.frame-group { display: flex; gap: 3px; align-items: stretch; flex: 0 0 auto; }
.hold-tick {
  flex: 0 0 auto; width: 18px; border: 2px solid var(--line); border-radius: 6px;
  background: var(--panel-2); cursor: pointer; display: flex; flex-direction: column;
  align-items: center; justify-content: space-between; padding: 4px 0;
}
.hold-tick.current { border-color: var(--accent); }
.hold-tick .tick-idx { font-size: 10px; color: var(--muted); writing-mode: vertical-rl; }
.hold-tick .tick-del {
  padding: 0; width: 14px; height: 14px; font-size: 10px; line-height: 1;
  border: none; background: transparent; color: var(--muted);
}
.hold-tick .tick-del:hover { color: var(--danger); }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: **no errors at all** — this task removes the last `reorderFrames` caller.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`

1. Add three text elements and capture a frame around them.
2. Press **+ Step** twice on that frame's card — two thin ticks appear beside it, numbered 2 and 3, and the header reads "1 shots · 3 steps".
3. Click each tick — the properties panel shows "Reveal step" naming the shot it inherits from, and the canvas camera does not move.
4. Capture a second frame elsewhere, then drag the first shot's card past it — the ticks travel with their shot and stay behind it.
5. Delete a tick with its ×, then delete the shot with **Del** — the remaining ticks go with it.

- [ ] **Step 6: Commit**

```bash
git add src/components/Timeline.tsx src/styles.css
git commit -m "feat: render hold steps as timeline ticks with group drag"
```

---

### Task 8: Player camera resolution and end-to-end verification

**Files:**
- Modify: `src/components/Player.tsx:29,59-70,84-88`

**Interfaces:**
- Consumes: `resolveFrameRect` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Route the player's camera through the resolver**

In `src/components/Player.tsx`, add the import:

```ts
import { resolveFrameRect } from "../playback/holds";
```

Replace the `camRef` initialiser:

```tsx
  const camRef = useRef<Camera>(frames[0] ? frameToCamera(frames[0], viewport) : { cx: 0, cy: 0, scale: 1, rotation: 0 });
```

with:

```tsx
  const camRef = useRef<Camera>(
    frames[0] ? frameToCamera(resolveFrameRect(frames, 0)!, viewport) : { cx: 0, cy: 0, scale: 1, rotation: 0 }
  );
```

Replace the body of `goTo`:

```tsx
  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(frames.length - 1, i));
      const f = frames[clamped];
      const rect = resolveFrameRect(frames, clamped);
      if (!f || !rect) return;
      setOverview(false);
      setIndex(clamped);
      broadcast(clamped, false);
      // A hold resolves to its shot's rect and is always "cut", so advancing into one is
      // instant and motionless — only the entering element animates.
      moveTo(frameToCamera(rect, viewport), f.easing, f.duration);
    },
    [frames, viewport, moveTo, broadcast]
  );
```

Replace the initial-landing effect body:

```tsx
    if (frames[0]) apply(frameToCamera(frames[0], viewport));
```

with:

```tsx
    if (frames[0]) apply(frameToCamera(resolveFrameRect(frames, 0)!, viewport));
```

- [ ] **Step 2: Typecheck and test**

Run: `npm run typecheck` — Expected: no errors.
Run: `npm test` — Expected: PASS.

- [ ] **Step 3: End-to-end manual verification**

Run: `npm run dev`

1. Create four separate text elements laid out as a bullet list, and capture a frame around them.
2. Click the first, then shift-click the other three in order — badges read 1–4.
3. In the properties panel press **Reveal one at a time** — three ticks appear on the shot.
4. Press play. Only bullet 1 is visible on arrival; each ↓/→ fades in the next one **with no camera movement**.
5. Press ← back through the build — bullets disappear in reverse. This is the check that visibility stayed index-pure.
6. Watch the progress bar across the build: it must advance on every step, not only on shot changes (spec D6).
7. Press **O** for overview and resume — the build state is preserved.
8. Return to the editor, pan/zoom somewhere new, select the shot's card and press **Re-capture from current view** — replay and confirm the whole build now happens at the new camera position. This is the live-link guarantee (spec D2).
9. Export to HTML, open the file, and step through the build. It must behave identically and the browser console must be clean.
10. Reload the editor — autosave must restore the build intact.

- [ ] **Step 4: Commit**

```bash
git add src/components/Player.tsx
git commit -m "feat: resolve hold cameras during playback"
```

---

## Follow-up (not this plan)

`docs/superpowers/plans/2026-07-02-motion-animation-enhancements.md` Tasks 4–11 are still outstanding, and its Task 8 assumed the pre-group `Timeline.tsx`. Re-read that task against the new `.frame-group` structure before executing it (spec D8).
