import { describe, expect, it, vi } from "vitest";
import type { Element, Presentation } from "../types";
import { DeckFolder } from "./deckFolder";
import { DECK_FILE, PLAYER_FILE, memoryFolder } from "./folderIO";
import { inlineAssets } from "../export/inline";

const deck = (elements: Element[], title = "T"): Presentation => ({
  id: "p1",
  title,
  createdAt: 0,
  updatedAt: 0,
  world: { backgroundColor: "#ffffff" },
  elements,
  frames: [],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
});
const el = (id: string, content: string): Element => ({
  id, type: "image", x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, content,
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
});
const A = `data:image/png;base64,${btoa("AAA")}`;
const json = (p: Presentation) => JSON.stringify(p, null, 2);
const never = () => {
  throw new Error("confirmReplace should not be called");
};
const snapshot = (io: ReturnType<typeof memoryFolder>) =>
  new Map([...io.files].map(([k, v]) => [k, v.lastModified]));

describe("DeckFolder.open", () => {
  it("loads an existing deck without writing anything", async () => {
    const onDisk = deck([el("e1", "assets/a.png")], "On disk");
    const io = memoryFolder("lec", { [DECK_FILE]: json(onDisk), "assets/a.png": "A" });
    const before = snapshot(io);
    const r = await new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never });
    expect(r).toEqual({ kind: "loaded", deck: onDisk });
    expect(snapshot(io)).toEqual(before);
  });

  it("asks before replacing a dirty project, and respects the answer", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: json(deck([])) });
    const no = vi.fn(() => false);
    expect(await new DeckFolder(io).open(deck([el("e", A)]), { isDirty: true, confirmReplace: no })).toEqual({
      kind: "cancelled",
    });
    expect(no).toHaveBeenCalledOnce();
    const yes = vi.fn(async () => true);
    expect((await new DeckFolder(io).open(deck([el("e", A)]), { isDirty: true, confirmReplace: yes })).kind).toBe(
      "loaded"
    );
  });

  it("adopts the current project into an empty folder, moving images to assets/", async () => {
    const io = memoryFolder("lec");
    const r = await new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: true, confirmReplace: never });
    expect(r.kind).toBe("adopted");
    if (r.kind !== "adopted") return;
    expect(r.deck.elements[0].content).toBe("assets/image.png");
    expect(await (await io.readBlob("assets/image.png"))!.text()).toBe("AAA");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text)).toEqual(r.deck);
    const html = (await io.readText(PLAYER_FILE))!.text;
    expect(html).toContain("assets/image.png");
    expect(html).not.toContain("base64");
  });

  it("treats a folder with unrelated files as empty but never overwrites them", async () => {
    const io = memoryFolder("lec", { "notes.txt": "keep me", "assets/image.png": "other bytes" });
    const r = await new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: false, confirmReplace: never });
    if (r.kind !== "adopted") throw new Error(r.kind);
    expect(r.deck.elements[0].content).toBe("assets/image-2.png");
    expect((await io.readText("notes.txt"))!.text).toBe("keep me");
    expect((await io.readText("assets/image.png"))!.text).toBe("other bytes");
  });

  it("refuses a folder holding an index.html but no deck, writing nothing", async () => {
    const io = memoryFolder("old-reveal-lecture", { [PLAYER_FILE]: "<html>reveal.js</html>" });
    const before = snapshot(io);
    await expect(new DeckFolder(io).open(deck([el("e1", A)]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /index\.html/
    );
    expect(snapshot(io)).toEqual(before);
  });

  it("refuses a malformed deck, writing nothing", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: "{ not json" });
    const before = snapshot(io);
    await expect(new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /not valid JSON/
    );
    expect(snapshot(io)).toEqual(before);
  });

  it("refuses JSON that is not a deck", async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: '{"hello": 1}' });
    await expect(new DeckFolder(io).open(deck([]), { isDirty: false, confirmReplace: never })).rejects.toThrow(
      /not a pres-sure deck/
    );
  });

  it("moves a folder deck into a new empty folder when inlined first", async () => {
    const a = memoryFolder("a", { "assets/a.png": new Blob(["AAA"], { type: "image/png" }) });
    const fromA = await inlineAssets(deck([el("e1", "assets/a.png")]), a);
    const b = memoryFolder("b");
    const r = await new DeckFolder(b).open(fromA, { isDirty: false, confirmReplace: never });
    if (r.kind !== "adopted") throw new Error(r.kind);
    const path = r.deck.elements[0].content;
    expect(await (await b.readBlob(path))!.text()).toBe("AAA");
  });
});

describe("DeckFolder.addAsset", () => {
  it("writes the file before returning its path", async () => {
    const io = memoryFolder("lec");
    const path = await new DeckFolder(io).addAsset(new File(["K"], "Keeling Curve.PNG", { type: "image/png" }));
    expect(path).toBe("assets/keeling-curve.png");
    expect(await (await io.readBlob(path))!.text()).toBe("K");
  });

  it("reuses identical bytes and suffixes clashing names", async () => {
    const io = memoryFolder("lec", { "assets/fig.png": new Blob(["X"], { type: "image/png" }) });
    const f = new DeckFolder(io);
    expect(await f.addAsset(new File(["X"], "copy.png", { type: "image/png" }))).toBe("assets/fig.png");
    expect(await f.addAsset(new File(["Y"], "fig.png", { type: "image/png" }))).toBe("assets/fig-2.png");
    expect(await f.addAsset(new File(["Y"], "again.png", { type: "image/png" }))).toBe("assets/fig-2.png");
  });
});

describe("DeckFolder.save", () => {
  const opened = async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: json(deck([])) });
    const f = new DeckFolder(io);
    await f.open(deck([]), { isDirty: false, confirmReplace: never });
    return { io, f };
  };

  it("skips the write when nothing changed", async () => {
    const { io, f } = await opened();
    const before = snapshot(io);
    expect(await f.save(deck([]))).toBe("unchanged");
    expect(snapshot(io)).toEqual(before);
  });

  it("writes the deck and the player when the deck changed", async () => {
    const { io, f } = await opened();
    const next = deck([el("e1", "assets/a.png")], "Changed");
    expect(await f.save(next)).toBe("saved");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text)).toEqual(next);
    expect((await io.readText(PLAYER_FILE))!.text).toContain("<title>Changed</title>");
  });

  it("reports a conflict and writes nothing after an external edit", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect(await f.checkExternalChange()).toBe(true);
    const before = snapshot(io);
    expect(await f.save(deck([], "Mine"))).toBe("conflict");
    expect(snapshot(io)).toEqual(before);
  });

  it("overwrites on force (Keep mine)", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect(await f.save(deck([], "Mine"), { force: true })).toBe("saved");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text).title).toBe("Mine");
    expect(await f.checkExternalChange()).toBe(false);
  });

  it("reload (Load from disk) returns the disk deck and clears the conflict", async () => {
    const { io, f } = await opened();
    await io.write(DECK_FILE, json(deck([], "From git")));
    expect((await f.reload()).title).toBe("From git");
    expect(await f.checkExternalChange()).toBe(false);
    expect(await f.save(deck([], "From git"))).toBe("unchanged");
  });
});

describe("DeckFolder.open resuming after a reload (edits newer than the last folder save)", () => {
  const setup = async () => {
    const io = memoryFolder("lec", { [DECK_FILE]: json(deck([], "Saved")) });
    const first = new DeckFolder(io);
    await first.open(deck([]), { isDirty: false, confirmReplace: never });
    return { io, stamp: first.modified };
  };

  it("keeps the newer in-browser copy when the deck on disk is the one we last wrote", async () => {
    const { io, stamp } = await setup();
    const local = deck([], "Edited just before reload");
    const f = new DeckFolder(io);
    const r = await f.open(local, { isDirty: false, confirmReplace: never, resumeIfUnchangedSince: stamp });
    expect(r).toEqual({ kind: "loaded", deck: local });
    expect(await f.save(local)).toBe("saved");
    expect(JSON.parse((await io.readText(DECK_FILE))!.text).title).toBe("Edited just before reload");
  });

  it("loads from disk when the deck changed since our last write (git pull)", async () => {
    const { io, stamp } = await setup();
    await io.write(DECK_FILE, json(deck([], "Pulled")));
    const r = await new DeckFolder(io).open(deck([], "Local"), {
      isDirty: false,
      confirmReplace: never,
      resumeIfUnchangedSince: stamp,
    });
    expect(r.kind === "loaded" && r.deck.title).toBe("Pulled");
  });

  it("loads from disk when the in-browser copy is a different deck", async () => {
    const { io, stamp } = await setup();
    const other = { ...deck([], "Other"), id: "p2" };
    const r = await new DeckFolder(io).open(other, { isDirty: false, confirmReplace: never, resumeIfUnchangedSince: stamp });
    expect(r.kind === "loaded" && r.deck.title).toBe("Saved");
  });
});
