// Folder deck -> embedded deck: the inverse of migrateEmbedded. Used so *Save .json* and
// *Export .html* stay portable, single-file downloads in folder mode (spec §4).
import type { Presentation } from "../types";
import { isAssetPath } from "../folder/assetNames";
import { blobToDataUrl } from "../folder/dataUrl";
import type { FolderIO } from "../folder/folderIO";

export async function inlineAssets(p: Presentation, io: FolderIO): Promise<Presentation> {
  const cache = new Map<string, string>();
  const elements = [];
  for (const el of p.elements) {
    if (el.type === "text" || !isAssetPath(el.content)) {
      elements.push(el);
      continue;
    }
    let url = cache.get(el.content);
    if (url === undefined) {
      const blob = await io.readBlob(el.content);
      // Missing on disk: keep the path; the player shows a broken image rather than failing.
      if (!blob) {
        elements.push(el);
        continue;
      }
      url = await blobToDataUrl(blob, el.content);
      cache.set(el.content, url);
    }
    elements.push({ ...el, content: url });
  }
  return { ...p, elements };
}
