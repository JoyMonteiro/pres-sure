import { describe, expect, it } from "vitest";
import { memoryFolder, splitPath } from "./folderIO";

describe("splitPath", () => {
  it("splits relative paths and rejects traversal", () => {
    expect(splitPath("assets/a.png")).toEqual(["assets", "a.png"]);
    expect(splitPath("deck.pressure.json")).toEqual(["deck.pressure.json"]);
    expect(splitPath("../secret")).toBeNull();
    expect(splitPath("assets/./a.png")).toBeNull();
    expect(splitPath("")).toBeNull();
  });
});

describe("memoryFolder", () => {
  it("reads back what was written, with increasing lastModified", async () => {
    const io = memoryFolder("lec", { "notes.txt": "hi" });
    expect(io.name).toBe("lec");
    const before = await io.lastModified("notes.txt");
    const { lastModified } = await io.write("assets/a.png", new Blob(["A"], { type: "image/png" }));
    expect(lastModified).toBeGreaterThan(before!);
    expect(await (await io.readBlob("assets/a.png"))!.text()).toBe("A");
    expect((await io.readText("notes.txt"))!.text).toBe("hi");
  });
  it("returns null for missing files", async () => {
    const io = memoryFolder();
    expect(await io.readText("nope")).toBeNull();
    expect(await io.readBlob("nope")).toBeNull();
    expect(await io.lastModified("nope")).toBeNull();
  });
  it("lists only files directly inside a directory", async () => {
    const io = memoryFolder("x", { "a.txt": "1", "assets/b.png": "2", "assets/sub/c.png": "3" });
    expect((await io.list("assets")).sort()).toEqual(["b.png"]);
    expect(await io.list("")).toEqual(["a.txt"]);
    expect(await io.list("missing")).toEqual([]);
  });
});
