// One open lecture folder (spec §4). No React, no store — the controller wires it up.
import type { Presentation } from "../types";
import { buildHtml } from "../export/exportHtml";
import { chooseAssetName, sanitizeName, sha256Hex } from "./assetNames";
import { ASSET_DIR, DECK_FILE, PLAYER_FILE, type FolderIO } from "./folderIO";
import { migrateEmbedded } from "./migrate";

export type OpenResult =
  | { kind: "loaded"; deck: Presentation }
  | { kind: "adopted"; deck: Presentation }
  | { kind: "cancelled" };

export type SaveResult = "saved" | "unchanged" | "conflict";

export function parseDeck(text: string): Presentation {
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error(`${DECK_FILE} is not valid JSON`);
  }
  const d = p as Presentation | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.elements) || !Array.isArray(d.frames)) {
    throw new Error(`${DECK_FILE} is not a pres-sure deck`);
  }
  return d;
}

export class DeckFolder {
  /** lastModified of DECK_FILE as of our last read or write (spec D8). */
  private knownModified: number | null = null;
  /** The exact text of DECK_FILE as of our last read or write — lets save() skip no-op writes. */
  private knownText: string | null = null;
  /** assets/ file name -> SHA-256, built lazily on first need. */
  private hashes: Map<string, string> | null = null;

  constructor(readonly io: FolderIO) {}

  get name(): string {
    return this.io.name;
  }

  async open(
    current: Presentation,
    opts: { isDirty: boolean; confirmReplace: () => boolean | Promise<boolean> }
  ): Promise<OpenResult> {
    const existing = await this.io.readText(DECK_FILE);
    if (existing) {
      const deck = parseDeck(existing.text); // throws before anything is written
      if (opts.isDirty && !(await opts.confirmReplace())) return { kind: "cancelled" };
      this.knownModified = existing.lastModified;
      this.knownText = existing.text;
      return { kind: "loaded", deck };
    }
    if ((await this.io.lastModified(PLAYER_FILE)) !== null) {
      throw new Error(
        `“${this.io.name}” already has an ${PLAYER_FILE} that pres-sure didn't create. ` +
          `Pick an empty folder or an existing pres-sure lecture folder.`
      );
    }
    const deck = await this.importEmbedded(current);
    await this.save(deck, { force: true });
    return { kind: "adopted", deck };
  }

  /** Write a deck's embedded images to assets/ and return it with paths (spec D7). */
  async importEmbedded(p: Presentation): Promise<Presentation> {
    const { deck, files, names } = await migrateEmbedded(p, await this.assetHashes());
    for (const f of files) await this.io.write(f.path, f.blob);
    this.hashes = names;
    return deck;
  }

  /** Store an added image in assets/ (spec D6). The file exists on disk before this resolves. */
  async addAsset(file: File): Promise<string> {
    const hashes = await this.assetHashes();
    const hash = await sha256Hex(file);
    const { name, reused } = chooseAssetName(sanitizeName(file.name, file.type), hash, hashes);
    const path = `${ASSET_DIR}/${name}`;
    if (!reused) {
      await this.io.write(path, file);
      hashes.set(name, hash);
    }
    return path;
  }

  async save(p: Presentation, opts: { force?: boolean } = {}): Promise<SaveResult> {
    if (!opts.force && (await this.checkExternalChange())) return "conflict";
    const text = JSON.stringify(p, null, 2);
    if (!opts.force && text === this.knownText) return "unchanged";
    await this.io.write(PLAYER_FILE, buildHtml(p));
    // The deck goes last, so knownModified always describes a fully written pair.
    const { lastModified } = await this.io.write(DECK_FILE, text);
    this.knownModified = lastModified;
    this.knownText = text;
    return "saved";
  }

  async checkExternalChange(): Promise<boolean> {
    return (await this.io.lastModified(DECK_FILE)) !== this.knownModified;
  }

  async reload(): Promise<Presentation> {
    const existing = await this.io.readText(DECK_FILE);
    if (!existing) throw new Error(`${DECK_FILE} is missing from “${this.io.name}”`);
    const deck = parseDeck(existing.text);
    this.knownModified = existing.lastModified;
    this.knownText = existing.text;
    return deck;
  }

  private async assetHashes(): Promise<Map<string, string>> {
    if (!this.hashes) {
      const m = new Map<string, string>();
      for (const name of await this.io.list(ASSET_DIR)) {
        const blob = await this.io.readBlob(`${ASSET_DIR}/${name}`);
        if (blob) m.set(name, await sha256Hex(blob));
      }
      this.hashes = m;
    }
    return this.hashes;
  }
}
