// Deep links into an exported deck: `deck.html#l3-keeling-curve` or `deck.html#12`.
// A frame's hash is its title slug, or its 1-based number when the slug is empty, already
// taken by an earlier frame, or all digits (which would read as a frame number).
// The reference implementation: runtime.ts re-implements it in plain JS for the exported
// file (which is emitted as a string and so cannot import), and the tests pin both to the
// same hashes.

export function titleSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The hash (without "#") that names each frame. */
export function frameHashes(titles: string[]): string[] {
  const taken = new Set<string>();
  return titles.map((title, i) => {
    const s = titleSlug(title);
    if (!s || /^\d+$/.test(s) || taken.has(s)) return String(i + 1);
    taken.add(s);
    return s;
  });
}

/** Frame index named by a location hash, or -1 if it names none. */
export function frameFromHash(hash: string, hashes: string[]): number {
  let h = hash.replace(/^#/, "");
  try {
    h = decodeURIComponent(h);
  } catch {
    return -1;
  }
  h = h.toLowerCase();
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    return n >= 1 && n <= hashes.length ? n - 1 : -1;
  }
  return h ? hashes.indexOf(h) : -1;
}
