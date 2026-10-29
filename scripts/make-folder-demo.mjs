// Generates fixtures/folder-demo/: a lecture folder with real image files, for the manual
// checks in fixtures/README.md (docs/superpowers/plans/2026-10-14-asset-folders.md, Task 9).
// Plain ESM with no imports from src/, like make-test-deck.mjs; shapes mirror src/types.ts.
// index.html is deliberately absent — the editor writes it on first save.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = "fixtures/folder-demo";
const STAMP = Date.parse("2026-10-14T00:00:00Z");

// --- A tiny PNG encoder (8-bit RGB), so the demo has a genuine raster asset. ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function stripesPng(w, h, colors) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colors[Math.floor((x / w) * colors.length)];
      const o = y * row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Warming-stripes palette, cold to hot.
const STRIPES = [
  [8, 48, 107], [33, 102, 172], [67, 147, 195], [146, 197, 222],
  [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 13],
];

const SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="110" fill="#f59e0b"/></svg>\n`;
const EARTH = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" fill="#2563eb"/><path d="M50 70q30-30 60 0t30 40-50 20" fill="#16a34a"/></svg>\n`;

const lifecycle = { enterAt: null, enterEffect: "none", onExit: "persist" };
const image = (id, type, content, x, y, w, h, z) => ({
  id, type, x, y, w, h, rotation: 0, z, content, naturalW: w, naturalH: h, lifecycle,
});
const shot = (id, title, x, y, w, h, notes) => ({
  id, title, x, y, w, h, rotation: 0, duration: "auto", easing: "smooth", notes,
});

const deck = {
  id: "folder-demo",
  title: "Lecture folder demo",
  createdAt: STAMP,
  updatedAt: STAMP,
  world: { backgroundColor: "#ffffff" },
  elements: [
    {
      id: "t-title", type: "text", x: 0, y: 0, w: 860, h: 97, rotation: 0, z: 0,
      content: "Lecture folder demo",
      textStyle: { fontSize: 44, fontWeight: 600, color: "#18181b", align: "left" },
      lifecycle,
    },
    image("i-sun", "svg", "assets/sun.svg", 0, 200, 300, 300, 1),
    image("i-earth", "svg", "assets/earth.svg", 420, 260, 180, 180, 2),
    // Natural size is 64x16; drawn stretched so a missing file is obvious at a glance.
    { ...image("i-stripes", "image", "assets/warming-stripes.png", 0, 640, 800, 200, 3), naturalW: 64, naturalH: 16 },
  ],
  frames: [
    shot("f-title", "Title", -40, -40, 940, 529, "Title only. Images load from assets/, not from the deck."),
    shot("f-sun-earth", "Sun and Earth", -40, 160, 700, 394, "Two SVG files from assets/."),
    shot("f-stripes", "Warming stripes", -40, 600, 880, 495, "A PNG file from assets/."),
  ],
  settings: { defaultEasing: "smooth", defaultDuration: "auto" },
};

mkdirSync(`${OUT}/assets`, { recursive: true });
writeFileSync(`${OUT}/assets/sun.svg`, SUN);
writeFileSync(`${OUT}/assets/earth.svg`, EARTH);
writeFileSync(`${OUT}/assets/warming-stripes.png`, stripesPng(64, 16, STRIPES));
writeFileSync(`${OUT}/deck.pressure.json`, JSON.stringify(deck, null, 2));
console.log(`wrote ${OUT}`);
