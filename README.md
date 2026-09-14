# pres-sure

A browser-based tool for building **zooming, spatial presentations** — a successor to Sozi.
Drop images, GIFs, SVGs and text onto an infinite canvas, frame "camera shots" over them,
and play or export a single self-contained `.html` file. The camera glides between shots
with a cinematic zoom (van Wijk smooth pan-zoom) rather than cutting between slides.

## Quick start

```bash
npm install
npm run dev      # editor at http://localhost:5173
```

- `npm run build` — production bundle
- `npm run preview` — serve the build
- `npm run typecheck` — TypeScript check

## Features

- Infinite zoomable/pannable world; place & arrange images, GIFs, SVGs, text.
- **Click-to-frame** and **frame-to-selection** camera capture (no coordinate entry).
- Cinematic transitions with named feels (Smooth / Snappy / Slow drift / Cut) and
  distance-aware timing.
- Reorderable timeline with **live CSS-clone thumbnails**.
- Element **entrance & exit** triggers (persist or leave).
- Playback with keyboard nav and a **zoom-to-overview** beat; **presenter view** with notes.
- **Autosave** (IndexedDB) + **undo/redo**; smart guides/snapping; starter templates.
- Export to a **single self-contained `.html`** that plays offline.

## Documentation

- **[User Manual](docs/USER_MANUAL.md)** — how to use every feature.
- **[Design & Implementation Spec](docs/design-and-implementation-spec.md)** — architecture
  and rationale.

## Tech

React + TypeScript + Vite, [Motion](https://motion.dev) for animation, Zustand + immer +
zundo for state and undo/redo, react-rnd for scale-aware drag/resize.

## License

BSD 3-Clause — see [LICENSE](LICENSE).
