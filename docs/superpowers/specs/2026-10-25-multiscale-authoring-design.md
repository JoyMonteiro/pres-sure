# Multi-scale authoring in pres-sure — design

*2026-10-25. From a brainstorming conversation with Joy Monteiro. Evidence comes from two
decks built with pres-sure: the ITC heat talk
(`~/Dropbox/IISER_Stuff/Presentations/ITC_2026_Heat_Workplace/`) and the Ocean module
(`~/Dropbox/IISER_Stuff/Teaching/intro_climate_science/Ocean_module/`).*

## Intent and the why

pres-sure already does the mechanical part of a zooming presentation well: place assets,
frame camera shots, glide between them, reveal in steps, export a file that plays offline.
Two real decks have been built with it.

Neither was authored in the editor. Both were compiled into pres-sure by a build script
(`deck/build_deck.mjs`, 78 KB for the ITC talk) that hand-rolls the thing pres-sure does not
have: a notion that content lives at **named scales**, nested inside one another. The script
calls them levels — `level(parent, x, y, s)` — lays each one out in its own units, and
multiplies font sizes by the level's scale so a text block reads the same once the camera
frames it. pres-sure itself has only a flat list of elements in world coordinates.

Asked where the time actually went on the ITC talk, Joy's answer was not about placement or
framing. It was *"thinking about how to replace the visual style, which was a bunch of slides
put next to each other and the camera panning to each, to something that looks like a single
visual and the camera moving to different parts of the same."*

That is the work pres-sure does not help with, and it is also — this is the key finding of
the conversation — the same work that makes a deck engaging. Asked what "more engaging"
means, Joy said: *"allowing the audience to not become confused with the camera movement, and
that it should feel natural — something that is likely to happen only when multiple scales
fit naturally with the story, and the tool helps organise it well."*

So the two halves of the original question — make decks more engaging, make them easier to
make — are one problem. Both reduce to: does the deck rest on a ladder of scales that fits
the story, and does the tool help the author build on it.

## The design test

> *"As of now I don't think the audience needs help. If they do, then pres-sure is not the
> right tool, or the story–tool fit is poor."* — Joy

Any proposal that helps the **audience** cope with the camera is treated as evidence that the
deck is wrong, not as a feature. Orientation overlays, breadcrumbs, scale indicators during
playback, "you are here" chrome: all rejected. The player stays as spare as it is today.

Everything in this design therefore acts **upstream**, on the author.

## Goals

1. An author can declare the named scales their story lives at, and pres-sure understands
   them.
2. An author working close in can see, live, how their edits look at the wider scales,
   without navigating away. (Joy: *"if I want the big picture to look fine, I must be free to
   add finer zoom content and not have to zoom out each time to see if everything looks
   ok."*)
3. The blank canvas stops being the starting point. "Name the scales your story lives at" is
   a smaller and more answerable first question than "arrange an infinite plane."
4. A set of quality-of-life gaps that both real decks had to work around are closed, so a
   build script is no longer *required* to produce a deck of this kind.
5. A separate skill helps someone who has an agent go from an argument to a buildable
   storyline document.

## Non-goals

- **Building the deck is not part of the skill.** The skill stops at a storyline document.
  Compiling that into pres-sure JSON is a separate job, handed to an implementing agent.
- **No audience-facing additions** (see the design test).
- **No drawing tools, shape libraries or chart builders.** pres-sure's existing stance holds:
  it places and frames content made elsewhere. The asset question turned out not to be the
  wall it looked like — Joy: *"students pick up SVGs from a whole bunch of places — I wouldn't
  underestimate their resourcefulness. Also free LLM accounts can also help here."*
- **No house palette.** When shown the orange/teal/indigo codes shared across
  `build_deck.mjs`, `figures/make_figures.py` and `figures/common.py`, Joy's response was
  *"what semantic palette?"* — so that is the colour coding of those particular talks, not a
  pres-sure style. A **library of built-in palettes to choose from** is wanted (see Part 2,
  item 2); what is excluded is any one of them, and the ITC codes especially, arriving as the
  implicit default look.

## Anti-goals

Things that would make this a failure even if they worked:

- **A more impressive camera.** Richer easings, motion paths, flying elements, parallax.
  These work directly against the one thing Joy wants, which is a camera the audience never
  has to think about.
- **Inferring the scales from geometry.** Tempting, because it costs nothing in the data
  model and would light up on both existing decks. Rejected on Joy's reasoning: *"entities
  will live at particular zoom levels and not at any arbitrary ones."* Geometry yields every
  containment relation there is, most of them meaningless — a caption sits inside a map's
  rect without being a scale. The ladder is editorial and must be declared.
- **Making the editor into the build script.** The point is not to reproduce
  `build_deck.mjs`'s power in a GUI. It is to make the one concept the script invented —
  nested named scales — native, so neither a human nor an agent has to re-invent it.

## Constraints

- Joy works locally; nothing is uploaded.
- Existing decks must keep loading. Both built decks are stored JSON with no notion of
  scales; the ITC deck is ~9 MB of data URIs.
- pres-sure is small on purpose (~3,700 lines of TS/TSX). Additions should respect that.
- Browsers clamp or drop very large font sizes. Today's workaround is to set world-scale text
  as glyph outlines (`figures/outline_text.py`, `figures/common.py`), which is why figure text
  and canvas text have to be kept in sync by hand.

---

## Part 1 — The scale ladder

### What it is

A deck gains a short, ordered list of **named scales** — three to five in practice — that the
author declares. A rung is a scale, **not a place**: Joy, asked directly, *"rung is not one
place, it is one scale. And yes, there can be multiple interesting things at different
locations that we want to look at."*

So any number of places can sit at the same rung. "Site" has one instance in the ITC deck;
"station" has seven (water, stock, block, rest, restNear, office, camp, gate), each with its
own position and scale factor inside the site. The Ocean module declares `LEVEL 2 · REGIONS
(×4–6)` and a column inside each region, so "column" has one instance per region.

The structure is therefore a **transform tree**: each node has a parent, a position and a
scale, and carries a label naming the rung it belongs to. The ladder is the ordered list of
labels; the tree is where things actually are. Elements belong to a node. Shots are taken at a
node.

The rungs are not zoom factors. They are the argument. Joy's ITC ladder, given as the
argument rather than as geometry:

> global heat stress → where India stands in that picture → variability within the South
> Asian region, which provides the meteorological context in which a construction site sits →
> the site itself as a thermal context for the worker

Each rung is *the context the next one sits in*. A biology deck would read organ → cell →
protein. This phrasing is the elicitation: a rung is named by what context it supplies.

**A finding worth carrying forward:** that ladder has five rungs; the deck as built has four
(`F_WORLD`, `F_INDIA`, `F_SITE`, `F_WORKER`). The regional-variability rung never became a
level — it is the city annual cycles lying on the India map. So the ladder named from the
argument and the ladder actually built are not automatically the same, and the tool should
make that divergence visible rather than silently fine.

### The nesting column

The primary interface onto the ladder, and the thing Joy picked from three mocked
alternatives (an overview minimap; this; a strip of user-pinned shots).

A column of live previews showing the **ancestor chain of wherever work is happening**,
ordered widest to narrowest, one entry per rung above the current node. Every preview
re-renders as the author edits, so adding fine detail at the narrowest rung immediately shows
its effect on the wider ones. Clicking an entry moves work to that scale.

Because a rung has many instances, the column is not a fixed set of panels. Working in the
office station it reads world → India → site → office; walk over to the camp and the bottom
entry swaps to camp while the three above it stay put.

This is both goal 2 and goal 3: it answers "how does this look zoomed out" continuously, and
it puts the ladder permanently on screen, so the author keeps track of *"the multiple scales
that exist in their content as well as in the presentation."*

### What follows from rungs existing

**A node's transform is live — it survives into rendering.** Joy's call, chosen over baking it
into world coordinates on write the way `place()` does today. So these are requirements, not
opportunities:

- **A node carries scale, and elements inherit it at render time.** This makes world-scale text
  an ordinary font size at its node's scale rather than a 10,000 px font, which is the route out
  of the outlined-glyph workaround. `figures/outline_text.py`, and the glyph-outline half of
  `Ocean_module/figures/common.py`, should stop being necessary. **This is now an acceptance
  criterion, not a side benefit.**
- **A node is a handle.** Moving or rescaling a node moves everything beneath it — the site and
  its seven stations — as one number, not a bulk rewrite. pres-sure has no grouping at all today.
- **A node answers questions.** "Which rungs does this element appear at" becomes answerable,
  which is also what drives the live previews.

The cost is accepted: this reaches most of the render paths, which all currently assume flat
world coordinates — `ElementView.tsx` (react-rnd takes a single `scale` prop, so nested scales
need the drag/resize math reworked), `snapping.ts`, `screenToWorld` in `camera/camera.ts`,
`Thumbnail.tsx`, `Stage.tsx`, the `maxZoom` blur hint, and the standalone player in
`src/export/runtime.ts`.

It also changes the exported JSON's shape. Nothing breaks: the change is additive, so a deck
with no nodes loads as one implicit root rung, and the existing build scripts keep emitting flat
coordinates and keep working. They simply get no rungs until someone updates them, which —
per "Builder check — resolved" below — is outside this repo's job.

### Left to the builder

- The data model's encoding, now that the shape is a labelled transform tree: how nodes are
  stored and referenced, whether labels are interned, how a node's effective transform is
  computed and cached. Must be additive: absent nodes mean one implicit root rung, so all
  built decks load untouched (the codebase's existing convention — see how `kind?: FrameKind`
  was added for holds — is the precedent).
- Whether shots belong to rungs or merely sit at them.
- Where the column lives and how it survives being rendered continuously. The timeline
  already does live CSS-clone thumbnails (`src/components/Thumbnail.tsx`), which is the
  obvious starting point and may not be cheap enough for four always-live panels.
- Whether the start-up flow (`TEMPLATES` in `src/store/templates.ts`) should ask for the
  ladder instead of offering narrative skeletons, or as well as.

---

## Part 2 — Quality-of-life changes

Joy asked for the scope to cover these: *"expand the scope to capture other quality of life
changes."* Each one is a workaround that both real decks had to perform. Priority is the
builder's call unless noted; the ladder comes first.

**1. External asset references and a companion-folder export.** Today every asset becomes a
data URI on import (`Toolbar.tsx`), and `exportHtml.ts` embeds the lot — *"assets are already
data URIs"*. The ITC deck is a 9 MB single file. The Ocean module's own handoff leaves this
as an open decision: *"whether to embed assets (ITC, 9 MB single file) or ship a companion
assets folder (SATW). With ~15 data fields, I'd go with the companion folder."*

pres-sure should support both, and **the choice belongs to the author at export time, not to
the tool** (Joy's instruction: the export should be *"asking whether to embed"*). So: elements
that can reference a file path rather than carry a data URI, and an export that prompts —
single self-contained file, or deck plus assets folder. Single-file export stays available,
since it is what makes a deck mailable; it just stops being the only option. The prompt
should carry enough information to decide with, i.e. the resulting size.

**2. One palette, read by every toolchain.** Not merely a deck-level theme. Joy's
requirement: *"if assets have to be built, having a single palette which is used downstream
for python and mjs without having to explicitly keep track in each place."*

Today the same colour codes are maintained by hand in at least three places —  `C` in
`deck/build_deck.mjs`, module constants in `Ocean_module/figures/common.py`, and
`ITC.../figures/make_figures.py` — with comments in each asking the reader to keep them in
sync (`common.py`: *"Same codes as C in deck/build_deck.mjs (ITC palette)"*). The figures and
the canvas have to agree on colour or the deck stops looking like one picture, and right now
nothing enforces that.

So the palette becomes a **declared artifact with one home**, in a format both ecosystems read
without ceremony — JSON is the obvious choice, since Python has `json` in the standard library
and the `.mjs` builder can `import` it directly. Named entries (semantic names, chosen per
deck), plus the font. pres-sure reads it as the deck's theme and lets elements refer to names
instead of hexes; the figure scripts read the same file; nobody copies a hex.

**Where the first one comes from, and who owns it after.** Joy's call: *"have a few built-in
palettes to choose from. These can be tweaked, but I'm fine with the file being a source of
truth once a palette is fixed."* So:

1. pres-sure ships **a few built-in palettes** the author picks from. This is the same move as
   the ladder — a student starting cold gets a coherent choice rather than a blank swatch and a
   colour picker, and the ones they scavenge assets around will at least agree with each other.
2. The author can **tweak** the chosen palette in the editor.
3. Once fixed, the palette is written out and **the file becomes the source of truth**. From
   then on the editor re-reads it rather than owning it, and palette-bound colours are not
   nudged in the editor behind the file's back — otherwise a tweak in the editor silently
   desynchronises the deck from the figures, which is the exact failure this closes.

An agent-driven workflow skips step 1 and writes the file directly, which is what happens today
except that the codes live in `common.py` instead of a shared file.

Two things this must not do. The built-in palettes **must not include the ITC codes as the
implicit default** — a named option in a library is fine, orange/teal/indigo arriving as "the
pres-sure look" is not; see non-goals. And consuming the file must not require a build step or
a package — a plain file read from both sides, or the design has failed at the thing it is for.

**3. Font embedding in the export.** `exportHtml.ts` uses a system font stack and notes that
*"font embedding is post-MVP"*. This is why `figures/common.py` sets all figure text as Inter
glyph outlines *and* loads Inter as a web font — so that figure text and canvas text match on
any machine. Embedding a font in the export removes a whole class of hand-synchronisation.
Pairs naturally with (1), since a companion folder can hold a woff2.

**4. Timing budgets.** Both storylines carry timing throughout — *"STOP 2 · Planet (≈5 min
for stops 2–3 together)"*, *"≈21 min; ≈5 min slack"* — as prose inside speaker notes, because
there is nowhere else to put it. Frames (or sections of frames) should carry a time budget,
and the presenter view should show pace against it rather than only an elapsed clock
(`PresenterView.tsx` has `elapsed` and nothing more).

**5. A rehearsal pass over the whole deck.** The Ocean module build order ends: *"open in the
editor and check every shot by eye (`npm run dev`), then export."* There is no view that
shows every shot at once. A contact sheet of all shots, and ideally automated checks (text
too small at its shot, raster past its native resolution — the blur hint in `maxZoom` already
knows how to ask this, elements that never appear in any shot) would replace an eyeball pass
that does not scale.

**6. Aspect-fit placement.** `addFigure()` in the build script exists mostly to fit a figure
into a box while keeping its aspect ratio, and to read natural size out of a PNG header or an
SVG viewBox. Plain editor work, currently manual.

**7. Video.** Listed in the manual as unsupported; GIFs are the workaround. Low priority, no
evidence from either deck that it bit.

*(Interactive widgets — sliders and live calculation — were raised and then dropped. They came
from an agent-authored tutorial spec in the Ocean module that Joy had not reviewed, not from
anything he asked for. Out of scope; if it ever comes back it needs its own conversation.)*

---

## Part 3 — The storyline skill

For authors who have an agent. Joy's own working pattern — Fable writes a self-contained plan,
a Sonnet agent executes it — is the shape this fits into.

**What it produces.** A storyline document. `PRESSURE_STORYLINE_W1.md` is the worked example
and effectively the target output: the ladder, a nested canvas layout, a shot list where each
entry names what is framed, what it holds, and the transition feel, an asset table mapping
each visual to its data source and the script that will draw it, and a build order. Timing
budgets throughout.

**Where it stops.** *"The actual build is not part of the skill."* It does not write
`build_deck.mjs` or emit pres-sure JSON.

**What it has to be good at.** Getting the ladder out of the author's argument. For Joy this
is nearly free — he said the multi-scale nature of his work makes pres-sure a more natural fit
than slides, and that world → India → site → worker *"was how I visualized the talk"*. The
skill should not assume that. Its central move is the one Joy's own phrasing demonstrates:
ask what context each scale supplies to the next, and keep asking until the chain runs from
the widest claim to the most human consequence.

It should also apply the design test as a check on its own output: if a shot sequence would
need the audience to be told where they are, the ladder is wrong and the fix is the ladder,
not the shot.

**Where it lives.** Not in this repo — `~/.claude/skills/`, alongside the others. This
document covers it because the ladder is the shared spine; the skill plans on the concept that
Part 1 makes native.

---

## Builder check — resolved

A reviewer read this document as a builder who could not ask questions. Four of its seven
questions are settled here; three need Joy and are listed in the next section.

**Authoring is editor-first *and* script-first, and that is not a contradiction.** The tool
changes exist for authors with no agent — Joy named himself-without-an-agent, students, and
digital storytellers — so the editor has to become genuinely able to build a deck of this
kind, and "what would it take to build Ocean W1 in the editor" is the right yardstick for
scoping Part 2. Joy's own workflow stays script-based, so the rung schema must be something a
script can emit. Consequences, my call: the schema change is **additive**, so all three
existing decks keep loading as one implicit rung; the out-of-repo build scripts are **not** a
supported API and updating them is outside this repo's job, even though they currently esbuild
`src/export/exportHtml.ts` straight out of this checkout (`build_deck.mjs` line 1054). Note
that `level()` is flattened at build time, so no existing deck can recover its ladder on
re-import — the decks that motivated this work will not benefit from it retroactively, and
that is accepted.

**External assets: export-side, plus the relative-path convention already in use.** My call.
The editor keeps embedding on import, so the hosted editor at GitHub Pages keeps working and
the export prompt can always state a true size. Export gains the companion-folder option.
Relative paths are blessed for local editor work, which is the convention the SATW deck
already documents as a known issue — *"image paths are relative (`satw-L1-L4_assets/...`), so
in the editor at `localhost:5173` they only load if that folder is served there, e.g.
symlinked into pres-sure's `public/`"*. The File System Access API is rejected: Chromium-only,
re-grant every session, dead on the Pages build, and it would make pres-sure own a project
folder on disk for the first time.

**Timing: per-frame budgets, rolled up. No section object.** My call. A frame carries an
optional budget; a shot plus its holds rolls up; the timeline can total a contiguous run
without a new named object in the model. This deliberately under-serves the prose in the
storylines (*"Space (stops 1–7, ≈14 min)"*), on the grounds that a named section spanning
frame ranges is a real model addition that may turn out to be a rung's shots anyway — so it
waits until the ladder is settled. Pace does need a start that does not exist today:
`PresenterView.tsx` starts its clock when the *window* opens, and `playback/sync.ts` carries
`{type, index, overview, presentationId}` with no clock origin, so a presentation start (and
pause) joins that channel.

**The skill is written last, and "done" is a shape, not an eval.** My call. Part 3's vocabulary
depends on the rung model, so writing it first would describe something that does not ship. It
lives in `~/.claude/skills/`, outside this repo, so it does not ride this branch or its review.
Done means it produces a storyline document of `PRESSURE_STORYLINE_W1.md`'s shape from an
author's argument. Whether it can reproduce W1's *quality* cold is an evaluation exercise worth
doing, but it is not the bar for shipping.

**One thing that needs no feature.** The divergence this document flags — five rungs named from
the argument, four built — falls out for free once rungs are declared: a declared rung with no
elements and no shots *is* the divergence. Surface it in the nesting column; do not build
anything else for it.

## Nothing open

The three questions the builder check left to Joy are all answered and written up above:

- **What a rung is** — a scale with many instances, so the model is a labelled transform tree.
  Under "The scale ladder".
- **Live or baked transforms** — live; node scale survives into rendering, which makes the
  outlined-glyph fix an acceptance criterion. Under "What follows from rungs existing".
- **Palette ownership** — built-in palettes to pick from, tweakable, and the file becomes the
  source of truth once a palette is fixed. Under Part 2, item 2.

## Decisions recorded as mine, not Joy's

- Explicit declared rungs rather than geometric inference. Joy did not choose between them
  directly; the choice follows from his statement that entities live at particular zoom levels
  and not arbitrary ones, and that the point is to convey which scales the story is built on.
- Three-to-five rungs as the expected ladder length. An observation from two decks, not a
  limit to enforce.
- Priority order within Part 2.
- JSON as the palette's format, on the grounds that both Python and an `.mjs` module read it
  with no tooling. Joy specified one palette read downstream by both, not the encoding.
- Keeping single-file export alongside a companion-folder export.
