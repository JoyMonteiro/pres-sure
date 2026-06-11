// Emit a single self-contained .html file (§5): static shell + embedded presentation
// JSON (assets are already data URIs) + the vanilla runtime. Plays with no editor and
// no network. Text uses a system-font stack for portability (font embedding is post-MVP).
import type { Presentation } from "../types";
import { slug, triggerDownload } from "../store/persistence";
import { runtimeScript } from "./runtime";

const SYSTEM_FONTS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function buildHtml(p: Presentation): string {
  const data = JSON.stringify(p).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(p.title)}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:${p.world.backgroundColor};font-family:${SYSTEM_FONTS};}
  #stage{position:fixed;inset:0;overflow:hidden;cursor:pointer;}
  #world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;}
  #progress{position:fixed;top:0;left:0;height:3px;width:0;background:#6d8bff;z-index:10;transition:width .2s;}
  #hint{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);color:#888;font-size:12px;z-index:10;opacity:.5;}
</style>
</head>
<body>
<div id="progress"></div>
<div id="stage"><div id="world"></div></div>
<div id="hint">← → / space to navigate · O for overview</div>
<script>window.__PRES__=${data};</script>
<script>${runtimeScript()}</script>
</body>
</html>`;
}

export function exportHtml(p: Presentation): void {
  const blob = new Blob([buildHtml(p)], { type: "text/html" });
  triggerDownload(blob, `${slug(p.title)}.html`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
