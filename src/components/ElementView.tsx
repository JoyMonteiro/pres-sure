import { useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { motion } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import type { Element } from "../types";
import { useStore } from "../store/store";
import { computeSnap } from "../playback/snapping";
import { STAGGER_STEP_S } from "../playback/stagger";

/** Editable element wrapped in react-rnd (scale-aware drag/resize — §2.2). */
export function EditableElement({ el, scale, selected }: { el: Element; scale: number; selected: boolean }) {
  const update = useStore((s) => s.updateElement);
  const select = useStore((s) => s.select);
  const setGuides = useStore((s) => s.setGuides);

  const others = () =>
    useStore.getState().presentation.elements.filter((e) => e.id !== el.id);

  // Raster blur hint (§3): displayed pixels vs natural pixels.
  let blur = false;
  if ((el.type === "image" || el.type === "gif") && el.naturalW) {
    const displayedPx = scale * el.w;
    if (displayedPx / el.naturalW > 1.3) blur = true;
  }

  return (
    <Rnd
      className={`element${selected ? " selected" : ""}`}
      position={{ x: el.x, y: el.y }}
      size={{ width: el.w, height: el.h }}
      scale={scale}
      onMouseDown={(e) => {
        e.stopPropagation();
        select([el.id]);
      }}
      onDrag={(_e, d) => {
        const { guides } = computeSnap({ x: d.x, y: d.y, w: el.w, h: el.h }, others(), 6 / scale);
        setGuides(guides);
      }}
      onDragStop={(_e, d) => {
        const snap = computeSnap({ x: d.x, y: d.y, w: el.w, h: el.h }, others(), 6 / scale);
        setGuides([]);
        update(el.id, { x: snap.x, y: snap.y });
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        update(el.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y })
      }
      enableResizing={selected}
      disableDragging={el.type === "text" && selected && document.activeElement?.getAttribute("data-el") === el.id}
    >
      <div className="content" style={{ transform: `rotate(${el.rotation}deg)`, width: "100%", height: "100%" }}>
        {selected && blur && <div className="blur-hint">⚠ zoomed past native resolution — may blur</div>}
        <ElementBody el={el} editable={selected && el.type === "text"} />
      </div>
    </Rnd>
  );
}

/** Read-only element used in playback / presenter / thumbnails. */
export function PlaybackElement({
  el,
  entering,
  leaving,
  staggerIndex = 0,
}: {
  el: Element;
  entering: boolean;
  leaving: boolean;
  staggerIndex?: number;
}) {
  const v = variantsFor(el, entering, leaving, staggerIndex);
  return (
    <motion.div
      className="element"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
      initial={v.initial}
      animate={v.animate}
      exit={v.exit}
      transition={v.transition}
    >
      <div className="content" style={{ transform: `rotate(${el.rotation}deg)`, width: "100%", height: "100%" }}>
        <ElementBody el={el} editable={false} />
      </div>
    </motion.div>
  );
}

/** Plain (non-animated, non-interactive) element — used in live CSS-clone thumbnails. */
export function StaticElement({ el }: { el: Element }) {
  return (
    <div className="element" style={{ left: el.x, top: el.y, width: el.w, height: el.h }}>
      <div className="content" style={{ transform: `rotate(${el.rotation}deg)`, width: "100%", height: "100%" }}>
        <ElementBody el={el} editable={false} />
      </div>
    </div>
  );
}

function ElementBody({ el, editable }: { el: Element; editable: boolean }) {
  const update = useStore((s) => s.updateElement);
  const ref = useRef<HTMLDivElement>(null);

  // Initialize contentEditable HTML once (avoid clobbering caret on re-render).
  useEffect(() => {
    if (el.type === "text" && ref.current && ref.current.innerHTML !== el.content) {
      ref.current.innerHTML = el.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id]);

  if (el.type === "text") {
    const ts = el.textStyle!;
    return (
      <div
        ref={ref}
        data-el={el.id}
        className="text-box"
        contentEditable={editable}
        suppressContentEditableWarning
        onBlur={(e) => update(el.id, { content: e.currentTarget.innerHTML })}
        style={{
          fontSize: ts.fontSize,
          fontWeight: ts.fontWeight,
          color: ts.color,
          textAlign: ts.align,
          cursor: editable ? "text" : "default",
        }}
      />
    );
  }

  // image / gif / svg are all <img> sources.
  return (
    <img
      src={el.content}
      alt=""
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (!el.naturalW && img.naturalWidth) {
          update(el.id, { naturalW: img.naturalWidth, naturalH: img.naturalHeight });
        }
      }}
    />
  );
}

function variantsFor(el: Element, entering: boolean, leaving: boolean, staggerIndex: number) {
  const lc = el.lifecycle;
  const off = 80;
  const dir = lc.enterDirection ?? "left";
  const slideFrom =
    dir === "left"
      ? { x: -off, y: 0 }
      : dir === "right"
        ? { x: off, y: 0 }
        : dir === "up"
          ? { x: 0, y: -off }
          : { x: 0, y: off };

  const delay = entering ? staggerIndex * STAGGER_STEP_S : 0;

  let initial: Record<string, number> = {};
  let animate: Record<string, number | number[]> = { opacity: 1, x: 0, y: 0, scale: 1 };
  let transition: Record<string, unknown> = { duration: 0.5, ease: [0.4, 0, 0.2, 1], delay };

  if (entering) {
    switch (lc.enterEffect) {
      case "fade":
        initial = { opacity: 0 };
        break;
      case "slide":
        initial = { opacity: 0, ...slideFrom };
        break;
      case "pulse":
        animate = { opacity: 1, scale: [1, 1.08, 1] };
        break;
      case "appear":
      case "none":
      default:
        initial = {};
    }
  }

  // Exits keep their own timing so a staggered entrance never delays a fade-out.
  let exit: TargetAndTransition = { opacity: 1 };
  if (leaving && lc.onExit === "leave") {
    const target = lc.exitEffect === "slide" ? { opacity: 0, ...slideFrom } : { opacity: 0 };
    exit = { ...target, transition: { duration: 0.4, ease: "easeIn" } };
  }

  return { initial, animate, exit, transition };
}
