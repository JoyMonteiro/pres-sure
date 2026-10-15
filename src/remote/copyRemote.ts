// "Save a copy": download a web image and store it in the project (spec D1, D9).
import { storeImageBlob } from "../store/assets";

export const COPY_BLOCKED_MESSAGE = "This site doesn't allow copying — add it as a link instead.";
export const NOT_AN_IMAGE_MESSAGE = "That address didn't return an image.";

export const isRemoteUrl = (content: string) => /^https?:\/\//i.test(content);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The URL's last path segment, decoded — a readable name for the stored file. */
export function nameHintFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "image";
  } catch {
    return "image";
  }
}

export async function copyRemoteImage(url: string): Promise<string> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    // CORS refusals and being offline both surface as a TypeError from fetch.
    throw new Error(COPY_BLOCKED_MESSAGE);
  }
  if (!blob.type.startsWith("image/")) throw new Error(NOT_AN_IMAGE_MESSAGE);
  return storeImageBlob(blob, nameHintFromUrl(url));
}
