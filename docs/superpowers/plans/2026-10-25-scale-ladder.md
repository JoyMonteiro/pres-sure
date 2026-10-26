# Scale Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pres-sure a declared ladder of named scales and a labelled transform tree, so an author can work at one scale while watching the wider ones live.

**Architecture:** A presentation gains `rungs` (an ordered list of named scales) and `nodes` (a tree; each node has a parent, a position and a scale in its parent's units, and a rung label). Elements and frames carry an optional `nodeId`; absent means the implicit root, so every existing deck loads untouched. Rendering places each node's content inside a nested CSS-transformed container, so a node's scale is a transform rather than a multiplied-out coordinate — which is what removes the browser font-size ceiling. Pure transform math lives in `src/nodes/` and is unit-tested; components consume it.

**Tech Stack:** React 18 + TypeScript, Zustand/immer/zundo, react-rnd, Motion, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-multiscale-authoring-design.md`

## Execution

Joy's instruction, 2026-10-25: **execute on `main`, no worktree.** This is the explicit
consent `superpowers:subagent-driven-development` requires before implementing on a default
branch — an executing session should not ask for it again. Execution happens in its own
session, not the one that wrote this plan.

## Global Constraints

- **Additive schema only.** A presentation with no `rungs`/`nodes`, and elements with no `nodeId`, must load and render exactly as today. Never write a default `nodeId` into stored data. Precedent: `kind?: FrameKind` in `src/types.ts`.
- **A rung is a scale, not a place.** Many nodes may carry the same `rungId`.
- **Node scale reaches the DOM as a transform, never as a multiplied font size.** A text element's `textStyle.fontSize` stays in its node's local units.
- **Tests are pure-function tests.** This repo has no React testing library and this plan does not add one; every task's tests target exported functions in `src/nodes/`, `src/playback/`, `src/store/` or `src/export/`. Component wiring is verified by `npm run typecheck` and by the fixture tests in Task 11.
- **Run with:** `npx vitest run <path>` for a single file, `npm test` for all, `npm run typecheck` for types.
- Existing decks cannot recover a ladder on re-import; `level()` was flattened at build time. Do not add migration heuristics that guess one.

## Review Focus

Five things the spec implies that no task's own tests would otherwise exercise. Each has a test added to the task that owns the code.

1. **An element whose `nodeId` names a node that does not exist.** Hand-built JSON and deleted nodes both produce this. It must render at the root, not vanish and not throw — a blank canvas on a typo is the worst failure this feature can have. *(Task 1)*
2. **A cycle in the node tree.** `a.parentId = b; b.parentId = a`, reachable by hand-editing JSON or a buggy reparent. Resolution must terminate and fall back to identity rather than hang the editor. *(Task 1)*
3. **Extreme cumulative scale.** The ITC ladder divides by 5, then 25, then 5 below the world level — a worker-level unit is 1/625 of an India-level one, on top of a world scale of 150. Resolution must stay finite and non-zero at that depth, and a node scale of `0` must not produce `NaN`/`Infinity` coordinates that poison the whole render. *(Task 1)*
4. **Deleting a node that has children and elements.** Children must not become unreachable orphans that still render at the root at full size. *(Task 3)*
5. **A node at a deeper rung than its parent, with rungs skipped.** The ladder is an ordered list of labels but the tree is free-form, so a "worker" node directly under a "world" node is legal input. The nesting column must render that chain without a gap entry or a crash. *(Task 8)*

---

### Task 1: Transform resolution

**Files:**
- Create: `src/nodes/transform.ts`
- Create: `src/nodes/transform.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Rung { id: string; name: string }`; `interface SceneNode { id: string; parentId: string | null; rungId: string; x: number; y: number; scale: number }`; `interface NodeTransform { ox: number; oy: number; s: number }`; `resolveTransform(nodes: SceneNode[], nodeId: string | null | undefined): NodeTransform`; `worldRect(el: Element, nodes: SceneNode[]): { x: number; y: number; w: number; h: number }`; `worldToLocal(pt: { x: number; y: number }, t: NodeTransform): { x: number; y: number }`. On `Element` and `Frame`: `nodeId?: string`. On `Presentation`: `rungs?: Rung[]`, `nodes?: SceneNode[]`.

- [x] **Step 1: Write the failing tests**

```ts
const IDENT = { ox: 0, oy: 0, s: 1 };
const n = (id: string, parentId: string | null, x: number, y: number, scale: number): SceneNode =>
  ({ id, parentId, rungId: "r", x, y, scale });

test("null nodeId resolves to identity", () => {
  expect(resolveTransform([], null)).toEqual(IDENT);
});

test("a root-parented node is its own offset and scale", () => {
  expect(resolveTransform([n("a", null, 10, 20, 2)], "a")).toEqual({ ox: 10, oy: 20, s: 2 });
});

test("a nested node composes parent offset with parent scale", () => {
  // child offset is in the parent's units, so it is scaled by the parent's scale
  const nodes = [n("a", null, 10, 20, 2), n("b", "a", 5, 5, 3)];
  expect(resolveTransform(nodes, "b")).toEqual({ ox: 20, oy: 30, s: 6 });
});

test("a missing nodeId resolves to identity rather than throwing", () => {
  expect(resolveTransform([n("a", null, 10, 20, 2)], "ghost")).toEqual(IDENT);
});

test("a cycle terminates and resolves to identity", () => {
  const nodes = [n("a", "b", 1, 1, 2), n("b", "a", 1, 1, 2)];
  expect(resolveTransform(nodes, "a")).toEqual(IDENT);
});

test("a deep chain stays finite at ITC depth", () => {
  // world 150, then /5, /25, /5 — the ITC ladder
  const nodes = [
    n("w", null, 0, 0, 150), n("i", "w", 0, 0, 1 / 5),
    n("s", "i", 0, 0, 1 / 25), n("k", "s", 0, 0, 1 / 5),
  ];
  const t = resolveTransform(nodes, "k");
  expect(t.s).toBeCloseTo(150 / 625, 12);
  expect(Number.isFinite(t.ox)).toBe(true);
});

test("a zero scale does not produce NaN downstream", () => {
  const t = resolveTransform([n("a", null, 5, 5, 0)], "a");
  expect(t.s).toBe(0);
  const r = worldRect({ ...el(), nodeId: "a", x: 1, y: 1, w: 2, h: 2 }, [n("a", null, 5, 5, 0)]);
  expect([r.x, r.y, r.w, r.h].every(Number.isFinite)).toBe(true);
});

test("worldRect places and scales an element by its node", () => {
  const nodes = [n("a", null, 100, 100, 2)];
  const r = worldRect({ ...el(), nodeId: "a", x: 10, y: 5, w: 20, h: 8 }, nodes);
  expect(r).toEqual({ x: 120, y: 110, w: 40, h: 16 });
});

test("worldToLocal inverts a transform", () => {
  const t = { ox: 100, oy: 100, s: 2 };
  expect(worldToLocal({ x: 120, y: 110 }, t)).toEqual({ x: 10, y: 5 });
});
```

Write a local `el()` helper in the test file returning a minimal `Element` (`makeElement("text", { content: "x" })` from `src/store/factory.ts`).

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/nodes/transform.test.ts`
Expected: FAIL — `src/nodes/transform.ts` does not exist.

- [x] **Step 3: Add the model types to `src/types.ts`**

Add `Rung`, `SceneNode`, `NodeTransform`; add `nodeId?: string` to `Element` and `Frame`; add `rungs?: Rung[]` and `nodes?: SceneNode[]` to `Presentation`. Comment each optional field with why it is optional (old saves load without migration), matching the house style of `kind?: FrameKind`.

- [x] **Step 4: Implement `src/nodes/transform.ts`**

`resolveTransform` walks from the node to the root composing `ox += x * s_parent` and `s *= scale`. Guard cycles with a visited set bounded by `nodes.length`; on a cycle, an unknown id, or a nullish id, return identity. `worldRect` applies the element's node transform to its local rect; `worldToLocal` divides out `s` and subtracts the offset, returning the point unchanged when `s === 0`.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/nodes/transform.test.ts` → PASS
Run: `npm run typecheck` → clean

- [x] **Step 6: Commit**

```bash
git add src/types.ts src/nodes/transform.ts src/nodes/transform.test.ts
git commit -m "feat: scene node transform resolution"
```

---

### Task 2: Tree queries

**Files:**
- Create: `src/nodes/tree.ts`
- Create: `src/nodes/tree.test.ts`

**Interfaces:**
- Consumes: `SceneNode`, `Rung` from Task 1.
- Produces: `ancestorChain(nodes: SceneNode[], nodeId: string | null | undefined): SceneNode[]` (root-first, inclusive of `nodeId`, `[]` for root/unknown/cyclic); `childrenOf(nodes: SceneNode[], nodeId: string | null): SceneNode[]`; `descendantIds(nodes: SceneNode[], nodeId: string): string[]` (excludes `nodeId` itself); `unusedRungs(pres: Presentation): Rung[]` — rungs with no node, or whose every node holds no element and no frame.

- [x] **Step 1: Write the failing tests**

```ts
test("ancestorChain is root-first and inclusive", () => {
  const nodes = [n("w", null), n("i", "w"), n("s", "i")];
  expect(ancestorChain(nodes, "s").map((x) => x.id)).toEqual(["w", "i", "s"]);
});

test("ancestorChain is empty for root and for an unknown id", () => {
  expect(ancestorChain([], null)).toEqual([]);
  expect(ancestorChain([n("w", null)], "ghost")).toEqual([]);
});

test("ancestorChain terminates on a cycle", () => {
  expect(ancestorChain([n("a", "b"), n("b", "a")], "a")).toEqual([]);
});

test("childrenOf(null) returns root-parented nodes", () => {
  const nodes = [n("w", null), n("i", "w"), n("x", null)];
  expect(childrenOf(nodes, null).map((c) => c.id)).toEqual(["w", "x"]);
});

test("descendantIds is deep and excludes the node itself", () => {
  const nodes = [n("w", null), n("i", "w"), n("s", "i")];
  expect(descendantIds(nodes, "w").sort()).toEqual(["i", "s"]);
});

test("unusedRungs reports a declared rung nothing sits at", () => {
  // the design's finding: five rungs named, four built
  const pres = presWith({
    rungs: [r("world"), r("region"), r("site")],
    nodes: [node("w", null, "world"), node("s", "w", "site")],
    elements: [elAt("w"), elAt("s")],
  });
  expect(unusedRungs(pres).map((x) => x.name)).toEqual(["region"]);
});

test("unusedRungs reports a rung whose nodes are empty", () => {
  const pres = presWith({
    rungs: [r("world"), r("site")],
    nodes: [node("w", null, "world"), node("s", "w", "site")],
    elements: [elAt("w")],
  });
  expect(unusedRungs(pres).map((x) => x.name)).toEqual(["site"]);
});
```

Write local `n`, `r`, `node`, `elAt`, `presWith` helpers in the test file.

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/nodes/tree.test.ts` → FAIL (module missing)

- [x] **Step 3: Implement `src/nodes/tree.ts`**

All four functions are plain traversals over the flat array; reuse Task 1's cycle guard rather than writing a second one (export it from `transform.ts` if needed). `unusedRungs` treats absent `rungs`/`nodes` as empty.

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run src/nodes/tree.test.ts` → PASS

- [x] **Step 5: Commit**

```bash
git add src/nodes/tree.ts src/nodes/tree.test.ts
git commit -m "feat: node tree queries and unused-rung detection"
```

---

### Task 3: Factories and store mutations

**Files:**
- Modify: `src/store/factory.ts`
- Modify: `src/store/store.ts`
- Create: `src/store/nodes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `makeRung(name: string): Rung`, `makeNode(partial: Partial<SceneNode> & Pick<SceneNode, "rungId">): SceneNode` in `factory.ts`. On the store: transient `currentNodeId: string | null` with `setCurrentNode(id: string | null): void`; history-tracked `addRung(name: string): string`, `renameRung(id: string, name: string): void`, `removeRung(id: string): void`, `addNode(partial: Partial<SceneNode> & Pick<SceneNode, "rungId">): string`, `updateNode(id: string, patch: Partial<SceneNode>): void`, `removeNode(id: string, mode: "promote" | "cascade"): void`, `moveElementToNode(elementId: string, nodeId: string | null): void`.

- [x] **Step 1: Write the failing tests**

```ts
test("addRung appends to the ladder and returns its id", () => { /* rungs order preserved */ });

test("addNode defaults to the root parent and scale 1", () => { /* parentId null, scale 1 */ });

test("updateNode patches position and scale", () => { /* x/y/scale written */ });

test("removeNode in promote mode reparents children and keeps their world transform", () => {
  // w(scale 2) > i(scale 3) > s; removing i must leave s resolving to the same world transform
  // as before, by folding i's offset and scale into each promoted child.
  // assert resolveTransform(after, "s") equals resolveTransform(before, "s")
});

test("removeNode in promote mode moves the node's own elements to its parent, keeping world rect", () => {
  // assert worldRect(el, after) equals worldRect(el, before)
});

test("removeNode in cascade mode deletes descendants and their elements", () => {
  // no orphan node and no element left pointing at a deleted node
});

test("moveElementToNode rewrites local coords so the element does not jump", () => {
  // worldRect before === worldRect after
});

test("removeRung leaves nodes intact but clears the label", () => { /* nodes keep ids; rungId cleared or reassigned per implementation note */ });
```

Drive these through `useStore.getState()` as a store test; there is no existing store test file, so this is the first.

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/store/nodes.test.ts` → FAIL

- [x] **Step 3: Implement the factories and store actions**

`removeNode` is the only non-obvious one and owns Review Focus item 4. In `promote` mode, for each child and each element of the removed node, compose the removed node's local transform into the child's/element's own `x`, `y` and `scale` before reparenting, so nothing moves on screen; in `cascade` mode, delete `descendantIds` plus the node and every element whose `nodeId` is in that set. `moveElementToNode` converts the element's world rect into the destination node's local units via `worldToLocal`. All mutations call `touch()` and run in one `set()` so each is a single undo entry.

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run src/store/nodes.test.ts` → PASS

- [x] **Step 5: Commit**

```bash
git add src/store/factory.ts src/store/store.ts src/store/nodes.test.ts
git commit -m "feat: rung and node mutations in the store"
```

---

### Task 4: Render through nested node layers

**Files:**
- Create: `src/components/NodeLayer.tsx`
- Create: `src/nodes/layers.ts`
- Create: `src/nodes/layers.test.ts`
- Modify: `src/components/Stage.tsx`
- Modify: `src/components/Thumbnail.tsx`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `interface Layer { node: SceneNode | null; elements: Element[]; children: Layer[] }`; `buildLayers(elements: Element[], nodes: SceneNode[]): Layer` (root layer, `node: null`); `layerTransform(node: SceneNode): string` (a CSS transform string). Component `<NodeLayer layer={...} render={(el) => ReactNode} />`.

- [ ] **Step 1: Write the failing tests**

```ts
test("buildLayers puts root-nodeId elements in the root layer", () => { /* elements with no nodeId */ });

test("buildLayers nests layers to match the node tree", () => { /* root > w > i, elements under each */ });

test("buildLayers places an element with an unknown nodeId in the root layer", () => {
  // Review Focus 1: a typo must not drop the element
});

test("buildLayers keeps z-order within a layer", () => { /* sorted ascending by z */ });

test("layerTransform emits translate then scale, in that order", () => {
  expect(layerTransform(n("a", null, 10, 20, 2))).toBe("translate(10px, 20px) scale(2)");
});

test("a text element deep in the tree keeps its local fontSize", () => {
  // The acceptance criterion from the spec: node scale reaches the DOM as a transform,
  // never as a multiplied font size. At ITC's world scale of 150, a 36px heading must
  // still be 36 in the model — a 5,400px font is the bug this feature exists to remove.
  const nodes = [n("w", null, 0, 0, 150)];
  const heading = { ...el(), nodeId: "w", textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 36 } };
  const root = buildLayers([heading], nodes);
  const placed = root.children[0].elements[0];
  expect(placed.textStyle!.fontSize).toBe(36);
  expect(layerTransform(nodes[0])).toContain("scale(150)");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/nodes/layers.test.ts` → FAIL

- [ ] **Step 3: Implement `src/nodes/layers.ts` and `NodeLayer.tsx`**

`buildLayers` groups elements by `nodeId`, treating unknown ids as root, and walks `childrenOf` to nest. `NodeLayer` renders `<div style={{ transform: layerTransform(node), transformOrigin: "0 0", position: "absolute" }}>` containing its elements via `render` and its child layers recursively; the root layer renders without a wrapper transform.

- [ ] **Step 4: Switch `Stage` and `Thumbnail` to node layers**

Both currently flat-map `presentation.elements`. Replace with `buildLayers(...)` + `<NodeLayer>`, passing their existing per-element render (`PlaybackElement` with its visibility/stagger logic for `Stage`, `StaticElement` for `Thumbnail`). Visibility and stagger stay keyed on the element, unchanged — do not move that logic into the layer.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npm test` → PASS (existing `deckFixtures`, `visibility`, `stagger`, `holds` tests must still pass)
Run: `npm run typecheck` → clean

- [ ] **Step 6: Commit**

```bash
git add src/nodes/layers.ts src/nodes/layers.test.ts src/components/NodeLayer.tsx src/components/Stage.tsx src/components/Thumbnail.tsx
git commit -m "feat: render elements through nested node layers"
```

---

### Task 5: Editing inside a node

**Files:**
- Modify: `src/components/EditCanvas.tsx`
- Modify: `src/components/ElementView.tsx`
- Create: `src/nodes/editing.ts`
- Create: `src/nodes/editing.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `effectiveScale(camScale: number, nodes: SceneNode[], nodeId: string | null | undefined): number` — the on-screen scale of one unit inside that node; `localDelta(d: { x: number; y: number }, t: NodeTransform): { x: number; y: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("effectiveScale multiplies camera scale by the node's cumulative scale", () => {
  expect(effectiveScale(0.5, [n("a", null, 0, 0, 4)], "a")).toBe(2);
});

test("effectiveScale is the camera scale at the root", () => {
  expect(effectiveScale(0.5, [], null)).toBe(0.5);
});

test("effectiveScale falls back to the camera scale for an unknown node", () => {
  expect(effectiveScale(0.5, [], "ghost")).toBe(0.5);
});

test("localDelta converts a world drag delta into node-local units", () => {
  expect(localDelta({ x: 20, y: 10 }, { ox: 0, oy: 0, s: 2 })).toEqual({ x: 10, y: 5 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/nodes/editing.test.ts` → FAIL

- [ ] **Step 3: Implement `src/nodes/editing.ts`**

- [ ] **Step 4: Wire `EditCanvas` and `EditableElement`**

`EditCanvas` renders through `buildLayers`/`NodeLayer` like `Stage`, so an element's `position`/`size` given to `Rnd` stay node-local and need no change. Pass `EditableElement` the element's `nodeId`; inside it, `scale` handed to `Rnd` becomes `effectiveScale(camScale, nodes, el.nodeId)`, and the snap threshold `6 / scale` uses that same effective scale so a 6-pixel tolerance stays 6 screen pixels at any depth. The blur-hint comparison (`scale * el.w` vs `el.naturalW`) must also use the effective scale, or deep-zoomed rasters stop warning.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npm test` → PASS; `npm run typecheck` → clean

- [ ] **Step 6: Commit**

```bash
git add src/nodes/editing.ts src/nodes/editing.test.ts src/components/EditCanvas.tsx src/components/ElementView.tsx
git commit -m "feat: edit elements inside a scene node"
```

---

### Task 6: Snapping across nodes

**Files:**
- Modify: `src/playback/snapping.ts`
- Create: `src/playback/snapping.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5.
- Produces: `computeSnap` stays as it is, operating on plain boxes — nothing else in the codebase should learn about nodes. Add `snapAcrossNodes(moving: { el: Element; box: Box }, others: Element[], nodes: SceneNode[], threshold: number): { x: number; y: number; guides: Guide[] }`, where `moving.box` is in the moving element's **local** units, the returned `x`/`y` are in those same local units so `updateElement` can write them straight back, and `guides` are in **world** units because that is the space `EditCanvas` draws them in. `threshold` is in world units; the caller passes `6 / camScale`.

- [ ] **Step 1: Write the failing tests**

```ts
// node a: scale 1 at the origin. node b: scale 2 at the origin.
// stationary element in a at local x 100 => world x 100.
// moving element in b at local x 49 => world x 98, which is 2 world units from alignment.
const nodes = [n("a", null, 0, 0, 1), n("b", null, 0, 0, 2)];

test("snapAcrossNodes aligns elements that match in world space, not in local numbers", () => {
  const still = { ...el(), nodeId: "a", x: 100, y: 0, w: 10, h: 10 };
  const moving = { ...el(), nodeId: "b", x: 49, y: 0, w: 5, h: 5 };
  const r = snapAcrossNodes({ el: moving, box: { x: 49, y: 0, w: 5, h: 5 } }, [still], nodes, 6);
  expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
});

test("the snapped position comes back in the moving element's local units", () => {
  const still = { ...el(), nodeId: "a", x: 100, y: 0, w: 10, h: 10 };
  const moving = { ...el(), nodeId: "b", x: 49, y: 0, w: 5, h: 5 };
  const r = snapAcrossNodes({ el: moving, box: { x: 49, y: 0, w: 5, h: 5 } }, [still], nodes, 6);
  expect(r.x).toBe(50); // world 100 / node b's scale of 2
});

test("nothing snaps when the world gap exceeds the threshold", () => {
  const still = { ...el(), nodeId: "a", x: 100, y: 0, w: 10, h: 10 };
  const moving = { ...el(), nodeId: "b", x: 20, y: 0, w: 5, h: 5 };
  const r = snapAcrossNodes({ el: moving, box: { x: 20, y: 0, w: 5, h: 5 } }, [still], nodes, 6);
  expect(r.guides).toEqual([]);
  expect(r.x).toBe(20);
});

test("a deck with no nodes behaves exactly as computeSnap does", () => {
  const still = { ...el(), x: 100, y: 0, w: 10, h: 10 };
  const moving = { ...el(), x: 98, y: 0, w: 10, h: 10 };
  const box = { x: 98, y: 0, w: 10, h: 10 };
  expect(snapAcrossNodes({ el: moving, box }, [still], [], 6))
    .toEqual(computeSnap(box, [{ x: 100, y: 0, w: 10, h: 10 }], 6));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/playback/snapping.test.ts`
Expected: FAIL — `snapAcrossNodes` is not exported.

- [ ] **Step 3: Implement**

Map the moving box and every other element through `worldRect`, call the existing `computeSnap` in world space, then convert the snapped point back with `worldToLocal` against the moving element's transform. Leave `computeSnap` untouched so its behaviour for node-free decks is the same function, not a reimplementation.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/playback/snapping.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/playback/snapping.ts src/playback/snapping.test.ts
git commit -m "feat: snap across scene nodes in world space"
```

---

### Task 7: Frames at a node

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/camera/camera.ts`
- Create: `src/store/frameNodes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `captureFrame` and `frameToSelection` record `nodeId: get().currentNodeId ?? undefined`; `boundingBox` gains a world-rect caller path. Frame geometry stays in **world** coordinates — only the label changes.

- [ ] **Step 1: Write the failing tests**

```ts
test("captureFrame records the current node", () => { /* nodeId set from currentNodeId */ });

test("captureFrame omits nodeId at the root", () => { /* absent, not null — additive schema */ });

test("frameToSelection fits the world rects of a selection spread across nodes", () => {
  // two elements in differently-scaled nodes; the frame must contain both in world space
});

test("a frame's rect is unaffected by its node's scale", () => {
  // frames are world-space; this pins that so a later refactor cannot quietly change it
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/store/frameNodes.test.ts`
Expected: FAIL — `captureFrame` does not set `nodeId`.

- [ ] **Step 3: Implement**

`frameToSelection` maps the selection through `worldRect` before `boundingBox`. Add a one-line comment at `captureFrame` saying why frame geometry stays world-space: the camera is global, and a frame that moved with its node would break every hold that resolves to it.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/store/frameNodes.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/camera/camera.ts src/store/frameNodes.test.ts
git commit -m "feat: frames record the node they were taken at"
```

---

### Task 8: The nesting column

**Files:**
- Create: `src/components/NestingColumn.tsx`
- Create: `src/nodes/column.ts`
- Create: `src/nodes/column.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `interface ColumnEntry { node: SceneNode | null; rungName: string; current: boolean; frame: Rect | null }`; `columnEntries(pres: Presentation, currentNodeId: string | null): ColumnEntry[]` — root-first, one entry per node in the ancestor chain plus a root entry, with `frame` the rect to preview (the node's own content bounds in world space, or `null` when it holds nothing).

- [ ] **Step 1: Write the failing tests**

```ts
test("columnEntries returns root plus the ancestor chain, widest first", () => {
  // world > site > office while working in office
});

test("the current node is the only entry marked current", () => { /* exactly one */ });

test("entries carry the rung's name, not the node's id", () => { /* rungName resolved */ });

test("a chain that skips rungs renders without a gap entry", () => {
  // Review Focus 5: a "worker"-rung node directly under a "world"-rung node
  // => two entries, no placeholder for the skipped rungs
});

test("a node holding nothing yields a null preview frame", () => { /* frame === null */ });

test("columnEntries at the root is a single entry", () => { /* length 1, current */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement `src/nodes/column.ts`**

`frame` is the world-space bounding box of the node's own elements plus its descendants', via `worldRect` and `descendantIds`.

- [ ] **Step 4: Build `NestingColumn.tsx` and mount it**

Render one `<Stage>` per entry at a small fixed size with `animate={false}`, reusing the Thumbnail/Stage path so previews are live by construction. The current entry is marked; clicking an entry calls `setCurrentNode`. Show `unusedRungs(pres)` (Task 2) as a muted note under the column — this is the five-named/four-built divergence, and it needs no other feature. Mount in `App.tsx`'s `.canvas-area` beside `EditCanvas`; add the grid column and entry styles to `styles.css` following the existing `.presenter` / `.frame-thumb` patterns.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npm test` → PASS; `npm run typecheck` → clean

- [ ] **Step 6: Commit**

```bash
git add src/nodes/column.ts src/nodes/column.test.ts src/components/NestingColumn.tsx src/App.tsx src/styles.css
git commit -m "feat: nesting column of live ancestor previews"
```

---

### Task 9: Export the node tree

**Files:**
- Modify: `src/export/runtime.ts`
- Modify: `src/export/exportHtml.ts`
- Modify: `src/export/runtime.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: the exported `window.__PRES__` carries `rungs` and `nodes`; the vanilla runtime builds the same nested transformed containers.

- [ ] **Step 1: Write the failing tests**

```ts
test("the runtime script positions an element inside its node's transform", () => {
  // assert the generated script contains the layer transform construction, and that a
  // presentation with nodes round-trips through buildHtml with nodes intact
});

test("a deck with no nodes exports byte-identical markup to today", () => {
  // the additive guarantee, pinned: snapshot or direct compare against buildHtml output
  // for an existing fixture
});

test("an element with an unknown nodeId exports at the root", () => { /* parity with Task 4 */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement**

The runtime is a hand-written string of vanilla JS; mirror `buildLayers`/`layerTransform` there rather than importing (it must stay dependency-free). Keep the font-size insight: a node's scale goes on the container's transform, never into an element's `fontSize`.

- [ ] **Step 4: Run to verify pass** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/export/runtime.ts src/export/exportHtml.ts src/export/runtime.test.ts
git commit -m "feat: export and play back the node tree"
```

---

### Task 10: Name your scales at startup

**Files:**
- Modify: `src/store/templates.ts`
- Modify: `src/App.tsx`
- Create: `src/store/ladder.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `presentationFromLadder(names: string[]): Presentation` in `templates.ts` — a deck with one rung per name and one node per rung, nested in order, each scaled by a sensible default step.

- [ ] **Step 1: Write the failing tests**

```ts
test("presentationFromLadder makes one rung per name, in order", () => { /* names preserved */ });

test("it nests one node per rung, each a child of the previous", () => { /* chain depth === names.length */ });

test("an empty ladder gives a blank presentation with no rungs", () => { /* parity with blankPresentation */ });

test("the deepest node's cumulative scale is finite and non-zero", () => { /* at 5 rungs */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement**

Pick one default scale step and state it in a comment with its reasoning (the ITC ladder's steps were 5, 25, 5 — not uniform, so the default is a starting point the author will change, not a prescription).

- [ ] **Step 4: Add the ladder step to the template picker in `App.tsx`**

The existing modal offers templates and a blank canvas. Add a third route — name your scales — collecting 1–6 names and calling `presentationFromLadder`. Keep it to text inputs; the design's point is that "name the scales your story lives at" is a smaller first question than a blank plane, and the copy should ask what context each scale provides for the next.

- [ ] **Step 5: Run the suite and typecheck** → PASS, clean

- [ ] **Step 6: Commit**

```bash
git add src/store/templates.ts src/store/ladder.test.ts src/App.tsx
git commit -m "feat: start a deck by naming its scales"
```

---

### Task 11: Backward-compatibility gate

**Files:**
- Modify: `src/playback/deckFixtures.test.ts`
- Create: `fixtures/nested-ladder.pressure.json`
- Modify: `fixtures/README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a fixture deck exercising a three-rung ladder with two sibling nodes at the deepest rung, for the same role the hold-frames fixtures play.

- [ ] **Step 1: Write the failing tests**

```ts
test("both existing fixtures load with no rungs and no nodes", () => {
  // hold-frames-demo and hold-frames-edge: rungs/nodes absent, not defaulted
});

test("every element in the existing fixtures resolves to its stored rect", () => {
  // worldRect(el, []) === { x: el.x, y: el.y, w: el.w, h: el.h } for every element
});

// The fixture's ladder, fixed here so the test and the JSON cannot drift:
//   world  node "w": parent null, x 0,    y 0,    scale 100
//   site   node "s": parent "w",  x 10,   y 20,   scale 0.5
//   bench  node "b1": parent "s", x 4,    y 0,    scale 0.2
//   bench  node "b2": parent "s", x 40,   y 0,    scale 0.2   <- same rung, different place
// b1 holds one text element at local (5, 5, 100, 40).
test("the nested fixture resolves its deepest element to the expected world rect", () => {
  // w: s=100. s: ox=1000, oy=2000, s=50. b1: ox=1000+4*50=1200, oy=2000, s=10.
  // element: x=1200+5*10=1250, y=2000+5*10=2050, w=1000, h=400.
  expect(worldRect(deepest, fixture.nodes)).toEqual({ x: 1250, y: 2050, w: 1000, h: 400 });
});

test("two sibling nodes at the same rung resolve to different places at the same scale", () => {
  // the 'a rung is a scale, not a place' guarantee, pinned
  const a = resolveTransform(fixture.nodes, "b1");
  const b = resolveTransform(fixture.nodes, "b2");
  expect(a.s).toBe(b.s);
  expect(b.ox - a.ox).toBe(1800); // (40 - 4) * 50
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (fixture missing)

- [ ] **Step 3: Build the fixture and implement**

Hand-write or script `fixtures/nested-ladder.pressure.json`: three rungs, a root node, and two siblings at the deepest rung, each holding one text element — small enough to read in a diff. Document it in `fixtures/README.md` alongside the hold-frames entries.

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npm test` → PASS; `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add fixtures/nested-ladder.pressure.json fixtures/README.md src/playback/deckFixtures.test.ts
git commit -m "test: pin backward compatibility and nested resolution"
```

---

## Out of this plan

Deliberately excluded, each its own plan once this lands (the design document's Part 2 and Part 3):

- **Assets, export and palette** — external asset references, the companion-folder export prompt, the built-in palette library and `palette.json` as source of truth, font embedding.
- **Presenting and rehearsal** — per-frame time budgets, presentation start/pause on the sync channel, the all-shots contact sheet and its automated checks.
- **The storyline skill** — in `~/.claude/skills/`, written against the vocabulary this plan ships.
- **Aspect-fit placement** and **video**, the two smallest Part 2 items.
