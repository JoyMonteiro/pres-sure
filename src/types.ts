// Core data model — mirrors §2.3 of the design & implementation spec.

export type ElementType = "image" | "gif" | "svg" | "text";

export type EnterEffect = "none" | "appear" | "fade" | "slide" | "pulse";
export type ExitEffect = "none" | "fade" | "slide";
export type SlideDirection = "left" | "right" | "up" | "down";

/** How an element appears and (optionally) leaves during playback. */
export interface Lifecycle {
  /** Frame at which the element enters. null = present from the very start. */
  enterAt: string | null;
  enterEffect: EnterEffect;
  enterDirection?: SlideDirection;
  /** persist (default) = stays after its frame; leave = removed when navigating past. */
  onExit: "persist" | "leave";
  /** Frame at/after which the element leaves (only meaningful with onExit: "leave"). */
  exitAt?: string | null;
  exitEffect?: ExitEffect;
}

export interface TextStyle {
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface Element {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  /** src/dataURI for media; HTML/plain string for text boxes. */
  content: string;
  /** Optional soft zoom cap derived from natural pixel size (raster only). */
  maxZoom?: number;
  /** Natural pixel dimensions for raster assets (used to compute maxZoom + blur hints). */
  naturalW?: number;
  naturalH?: number;
  textStyle?: TextStyle;
  lifecycle: Lifecycle;
  /**
   * The scene node this element lives in; its x/y/w/h are in that node's local units.
   * Absent means "directly in the world" — never write a default node id into stored
   * data, so old saves stay loadable without migration.
   */
  nodeId?: string;
}

/** Named transition "feels" — map to a curve or a spring (§4.4). */
export type EasingPreset = "smooth" | "snappy" | "slowDrift" | "cut";

/** "shot" carries its own camera; "hold" borrows the preceding shot's (see spec D3). */
export type FrameKind = "shot" | "hold";

export interface Frame {
  id: string;
  title: string;
  /** The camera rectangle over the world (fit-to-contain at play time). */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Transition duration into this frame (ms). "auto" = distance-aware (van Wijk path). */
  duration: number | "auto";
  easing: EasingPreset;
  notes: string;
  /**
   * A "hold" is a reveal step: it has no camera of its own and resolves to the nearest
   * preceding shot. Absent means "shot" — never write "shot" into stored data, so old
   * saves stay loadable without migration.
   */
  kind?: FrameKind;
  /**
   * The scene node this frame's camera rect is expressed in. Absent means the rect is
   * already in world units — never write a default node id into stored data, so old
   * saves stay loadable without migration.
   */
  nodeId?: string;
}

/** A named rung of the scale ladder — an author-facing level like "slide" or "world". */
export interface Rung {
  id: string;
  name: string;
}

/**
 * A placed scale: a node offsets and scales its contents inside its parent, so content
 * can be authored in comfortable local units at any depth.
 */
export interface SceneNode {
  id: string;
  /** null = parented straight to the world. */
  parentId: string | null;
  rungId: string;
  /** Offset within the parent, in the parent's local units. */
  x: number;
  y: number;
  /** Size of one local unit in the parent's units. */
  scale: number;
}

/** A resolved node-to-world transform: world = local * s + offset. */
export interface NodeTransform {
  ox: number;
  oy: number;
  s: number;
}

export interface WorldSettings {
  backgroundColor: string;
}

export interface PresentationSettings {
  defaultEasing: EasingPreset;
  defaultDuration: number | "auto";
}

export interface Presentation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  world: WorldSettings;
  elements: Element[];
  frames: Frame[];
  settings: PresentationSettings;
  /**
   * The scale ladder. Absent on presentations authored before the ladder existed —
   * never write an empty array into stored data, so old saves load without migration.
   */
  rungs?: Rung[];
  /** The scene node tree. Absent for the same reason as `rungs`. */
  nodes?: SceneNode[];
}
