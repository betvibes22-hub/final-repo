// ────────────────────────────────────────────────
// Programmatic stickman animation — type definitions
// ────────────────────────────────────────────────

/** Pose name drives how arms/legs are positioned each frame. */
export type StickmanPose =
  | "idle"        // standing, arms relaxed at side
  | "point-right" // right arm extended, pointing right
  | "point-left"  // left arm extended, pointing left
  | "celebrate"   // both arms raised triumphantly
  | "question"    // arms out palms-up (questioning pose)
  | "teach"       // right arm raised with "pointer" gesture
  | "walk"        // walking stance, legs spread
  | "slump";      // dejected, slight lean, arms down

/** Character fill color */
export type CharacterColor =
  | "black"
  | "blue"
  | "red"
  | "green"
  | "purple"
  | "orange";

/** Background color theme */
export type BgTheme =
  | "minimal"   // clean white
  | "warm"      // soft cream/yellow
  | "cool"      // light blue/gray
  | "dark"      // dark navy/charcoal
  | "bold-red"  // vivid red accent
  | "bold-blue" // vivid blue accent
  | "bold-green";

/** Visual rendering style */
export type AnimStyle =
  | "classic"   // black outlines, white fill
  | "colorful"  // colored characters, vibrant bg
  | "dark"      // white stickman on dark bg
  | "chunky";   // extra thick lines (bold energy)

/** Optional character accessories */
export interface CharacterAccessory {
  hat?: boolean;
  glasses?: boolean;
  tie?: boolean;
}

/**
 * How the clip enters the scene.
 * - pop: zoom-scale from 0.92→1 (punchy)
 * - slide-left: slides in from right edge
 * - slide-right: slides in from left edge
 */
export type EntranceType = "pop" | "slide-left" | "slide-right";

/** One stickman character to draw in a frame */
export interface Character {
  pose: StickmanPose;
  color: CharacterColor;
  cx: number;            // center X of the stickman
  headY: number;         // Y of the head center
  scale?: number;        // 1.0 default
  flipX?: boolean;       // mirror horizontally (face left)
  accessory?: CharacterAccessory;
  /** Animation phase 0..1 drives limb oscillation */
  animPhase?: number;
}

/** All data needed to draw one frame */
export interface StickmanFrameSpec {
  width: number;
  height: number;
  bg: BgTheme;
  animStyle: AnimStyle;
  headline: string;
  subtext?: string;
  characters: Character[];
  /** 0..1 — drives zoom transform applied to the whole canvas */
  zoomProgress: number;
  /** 0..1 — drives entrance pop scale */
  entranceProgress: number;
  /** Horizontal pan offset in pixels (Ken Burns camera drift) */
  panX?: number;
  /** Vertical pan offset in pixels */
  panY?: number;
  /** Entrance slide offset in pixels (positive = from right, negative = from left) */
  slideX?: number;
}

/** Config produced by interpreter for one scene clip */
export interface StickmanSceneConfig {
  headline: string;
  subtext?: string;
  bg: BgTheme;
  animStyle: AnimStyle;
  characters: Character[];
  /** total frames to render */
  frames: number;
  fps: number;
  /** zoom from/to for Ken Burns effect */
  zoomFrom?: number;
  zoomTo?: number;
  /** pan motion: camera drifts from (panFromX, panFromY) to (panToX, panToY) over the clip */
  panFromX?: number;
  panToX?: number;
  panFromY?: number;
  panToY?: number;
  /** how the clip enters the scene */
  entranceType?: EntranceType;
}
