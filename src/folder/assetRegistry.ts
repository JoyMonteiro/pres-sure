// Path -> blob: URL registry (spec §4). Module-level, one per window: the editor and the
// presenter window each point it at the lecture folder. React-free; see useAssetSrc.ts.
import { isAssetPath } from "./assetNames";
import type { FolderIO } from "./folderIO";

type Entry = { state: "loading" } | { state: "ready"; url: string } | { state: "missing" };

const placeholders = new Set<string>();
const svgPlaceholder = (fill: string, label: string) => {
  const text = label
    ? `<text x="200" y="155" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">${label}</text>`
    : "";
  const src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="${fill}"/>${text}</svg>`
    );
  placeholders.add(src);
  return src;
};
const escapeXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const LOADING_SRC = svgPlaceholder("#d4d4d8", "");
export const missingSrc = (path: string): string => svgPlaceholder("#dc2626", `missing: ${escapeXml(path)}`);
/** True for the loading/missing placeholders — their pixel size must never reach the deck. */
export const isPlaceholderSrc = (src: string): boolean => placeholders.has(src);

let folder: FolderIO | null = null;
let entries = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version++;
  listeners.forEach((l) => l());
}

export function setRegistryFolder(io: FolderIO | null): void {
  for (const e of entries.values()) if (e.state === "ready") URL.revokeObjectURL(e.url);
  entries = new Map();
  folder = io;
  bump();
}

export function registerAsset(path: string, blob: Blob): void {
  const prev = entries.get(path);
  if (prev?.state === "ready") URL.revokeObjectURL(prev.url);
  entries.set(path, { state: "ready", url: URL.createObjectURL(blob) });
  bump();
}

export function resolveAssetSrc(content: string): string {
  if (!isAssetPath(content)) return content;
  if (!folder) return missingSrc(content);
  const e = entries.get(content);
  if (e?.state === "ready") return e.url;
  if (e?.state === "missing") return missingSrc(content);
  if (!e) load(folder, content);
  return LOADING_SRC;
}

function load(io: FolderIO, path: string) {
  entries.set(path, { state: "loading" });
  const settle = (entry: Entry) => {
    if (folder !== io) return; // folder switched while loading
    entries.set(path, entry);
    bump();
  };
  io.readBlob(path).then(
    (blob) => settle(blob ? { state: "ready", url: URL.createObjectURL(blob) } : { state: "missing" }),
    () => settle({ state: "missing" })
  );
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const registryVersion = (): number => version;
