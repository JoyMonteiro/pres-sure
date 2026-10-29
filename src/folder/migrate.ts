// Embedded deck -> folder deck (spec D7): data: URIs become files in assets/.
import type { Element, Presentation } from "../types";
import { chooseAssetName, sanitizeName, sha256Hex } from "./assetNames";
import { dataUrlToBlob } from "./dataUrl";
import { ASSET_DIR } from "./folderIO";

export interface PendingFile {
  path: string;
  blob: Blob;
}

export async function migrateEmbedded(
  p: Presentation,
  existing: ReadonlyMap<string, string>
): Promise<{ deck: Presentation; files: PendingFile[]; names: Map<string, string> }> {
  const names = new Map(existing);
  const files: PendingFile[] = [];
  const elements: Element[] = [];
  for (const el of p.elements) {
    if (el.type === "text" || !el.content.startsWith("data:")) {
      elements.push(el);
      continue;
    }
    const blob = dataUrlToBlob(el.content);
    const hash = await sha256Hex(blob);
    const { name, reused } = chooseAssetName(sanitizeName("", blob.type), hash, names);
    if (!reused) {
      names.set(name, hash);
      files.push({ path: `${ASSET_DIR}/${name}`, blob });
    }
    elements.push({ ...el, content: `${ASSET_DIR}/${name}` });
  }
  return { deck: { ...p, elements }, files, names };
}
