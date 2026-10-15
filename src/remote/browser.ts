// Browser implementations of the network seams in resolveImage.ts.
import type { FetchJson, ProbeSize } from "./resolveImage";

export const fetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** Load the image to learn its size. Displaying needs no CORS, so this works anywhere. */
export const probeSize: ProbeSize = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
