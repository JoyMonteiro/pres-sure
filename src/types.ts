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
}

export interface WorldSettings {
  backgroundColor: string;
}

export type WebImagesMode = "link" | "copy";

export interface PresentationSettings {
  defaultEasing: EasingPreset;
  defaultDuration: number | "auto";
  /**
   * Default for "+ From web": link to the image or save a copy in the project. Absent
   * means "link" — never written until the user picks, so old saves need no migration.
   */
  webImages?: WebImagesMode;
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
}
