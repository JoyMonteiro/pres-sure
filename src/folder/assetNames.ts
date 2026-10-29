// Asset naming (spec D6) and content classification (spec D5). Pure apart from hashing.

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const MAX_STEM = 80;

/** True when `content` is a path relative to the lecture folder (not data:, http(s):, blob:). */
export function isAssetPath(content: string): boolean {
  return content !== "" && !/^(data:|https?:|blob:)/i.test(content);
}

export function sanitizeName(filename: string, mime: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawStem = dot >= 0 ? base.slice(0, dot) : base;
  const rawExt = dot >= 0 ? base.slice(dot + 1) : "";
  const stem =
    rawStem
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, MAX_STEM) || "image";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || EXT_BY_MIME[mime.split(";")[0]] || "bin";
  return `${stem}.${ext}`;
}

export function chooseAssetName(
  desired: string,
  hash: string,
  existing: ReadonlyMap<string, string>
): { name: string; reused: boolean } {
  for (const [name, h] of existing) if (h === hash) return { name, reused: true };
  if (!existing.has(desired)) return { name: desired, reused: false };
  const dot = desired.lastIndexOf(".");
  const stem = dot >= 0 ? desired.slice(0, dot) : desired;
  const ext = dot >= 0 ? desired.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existing.has(candidate)) return { name: candidate, reused: false };
  }
}

export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
