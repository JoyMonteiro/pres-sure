import { describe, expect, it } from "vitest";
import type { Element, Presentation } from "../types";
import { migrateEmbedded } from "./migrate";
import { inlineAssets } from "../export/inline";
import { memoryFolder } from "./folderIO";
import { sha256Hex } from "./assetNames";
import { dataUrlToBlob } from "./dataUrl";

const deck = (elements: Element[]): Presentation => ({
  id: "p1",
  title: "T",
  createdAt: 0,
  updatedAt: 0,
  world: { backgroundColor: "#ffffff" },
  elements,
  frames: [],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
});
const el = (id: string, content: string, type: Element["type"] = "image"): Element => ({
  id, type, x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, content,
  lifecycle: { enterAt: null, enterEffect: "none", onExit: "persist" },
});

const A = `data:image/png;base64,${btoa("AAA")}`;
const C = `data:image/png;base64,${btoa("CCC")}`;
const B = `data:image/jpeg;base64,${btoa("BBB")}`;
const REMOTE = "https://upload.wikimedia.org/x.png";
// A text box whose HTML happens to look like a path must never be touched.
const TEXT_PATHLIKE = "assets/looks-like-a-path.png";

const mixed = () =>
  deck([el("e1", A), el("e2", C), el("e3", A), el("e4", B), el("r", REMOTE), el("t", TEXT_PATHLIKE, "text")]);

describe("migrateEmbedded", () => {
  it("writes one file per distinct image and points elements at them", async () => {
    const { deck: out, files } = await migrateEmbedded(mixed(), new Map());
    const content = Object.fromEntries(out.elements.map((e) => [e.id, e.content]));
    expect(content).toEqual({
      e1: "assets/image.png",
      e2: "assets/image-2.png",
      e3: "assets/image.png",
      e4: "assets/image.jpg",
      r: REMOTE,
      t: TEXT_PATHLIKE,
    });
    expect(files.map((f) => f.path)).toEqual(["assets/image.png", "assets/image-2.png", "assets/image.jpg"]);
    expect(await files[0].blob.text()).toBe("AAA");
  });

  it("does not mutate its input", async () => {
    const input = mixed();
    await migrateEmbedded(input, new Map());
    expect(input.elements[0].content).toBe(A);
  });

  it("is a no-op on an already-migrated deck", async () => {
    const first = await migrateEmbedded(mixed(), new Map());
    const second = await migrateEmbedded(first.deck, first.names);
    expect(second.files).toEqual([]);
    expect(second.deck).toEqual(first.deck);
  });

  it("reuses files already in the folder and avoids their names", async () => {
    const existing = new Map([
      ["image.png", await sha256Hex(dataUrlToBlob(A))], // same bytes as A
      ["image.jpg", "some-other-hash"], // name taken by different bytes
    ]);
    const { deck: out, files } = await migrateEmbedded(deck([el("e1", A), el("e4", B)]), existing);
    expect(out.elements.map((e) => e.content)).toEqual(["assets/image.png", "assets/image-2.jpg"]);
    expect(files.map((f) => f.path)).toEqual(["assets/image-2.jpg"]);
  });
});

describe("inlineAssets", () => {
  it("round-trips with migrateEmbedded", async () => {
    const original = mixed();
    const { deck: migrated, files } = await migrateEmbedded(original, new Map());
    const io = memoryFolder();
    for (const f of files) await io.write(f.path, f.blob);
    expect(await inlineAssets(migrated, io)).toEqual(original);
  });

  it("leaves a path in place when its file is missing", async () => {
    const p = deck([el("e1", "assets/gone.png")]);
    expect((await inlineAssets(p, memoryFolder())).elements[0].content).toBe("assets/gone.png");
  });
});
