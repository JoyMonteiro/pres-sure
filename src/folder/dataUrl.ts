// Data-URI <-> Blob conversion without FileReader, so it runs under Node in tests.

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function mimeFromName(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("Not a data URI");
  const params = url.slice(5, comma).split(";"); // e.g. ["image/png", "base64"]
  const mime = params[0] || "text/plain";
  const payload = url.slice(comma + 1);
  if (params.includes("base64")) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

export async function blobToDataUrl(blob: Blob, nameHint = ""): Promise<string> {
  const mime = blob.type || mimeFromName(nameHint);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // String.fromCharCode(...) has an argument-count limit, so encode in chunks.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
