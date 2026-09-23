/**
 * Interprets a scene's visual prompt into a StickmanSceneConfig.
 *
 * Uses keyword matching on the visualPrompt to decide:
 *  - How many characters (1 or 2)
 *  - What pose each character should hold
 *  - Which character color (A = blue, B = red)
 *  - Background theme
 *  - Headline text
 *  - Per-clip motion: zoom direction, camera pan, entrance type
 */

import { Scene } from "../../types";
import {
  AnimStyle,
  BgTheme,
  Character,
  CharacterColor,
  EntranceType,
  StickmanPose,
  StickmanSceneConfig,
} from "./types";

// ─── pose detection ────────────────────────────────────────────────────────

const POSE_KEYWORDS: Array<{ keywords: string[]; pose: StickmanPose }> = [
  { keywords: ["celebrat", "excit", "cheer", "jump", "win", "victory", "party", "danc", "happy", "yay"], pose: "celebrate" },
  { keywords: ["question", "wonder", "confused", "confus", "huh", "what", "unsure", "thinking", "differ"], pose: "question" },
  { keywords: ["teach", "explain", "point up", "present", "show", "educat", "lesson"], pose: "teach" },
  { keywords: ["point right", "pointing right", "toward right"], pose: "point-right" },
  { keywords: ["point left", "pointing left", "toward left"], pose: "point-left" },
  { keywords: ["walk", "run", "mov", "step", "strid"], pose: "walk" },
  { keywords: ["sad", "slump", "deject", "down", "cry", "upset", "depress", "alone", "lonely", "tired"], pose: "slump" },
  { keywords: ["point", "gesture", "direct"], pose: "point-right" },
];

function detectPose(prompt: string): StickmanPose {
  const lower = prompt.toLowerCase();
  for (const { keywords, pose } of POSE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return pose;
  }
  return "idle";
}

// ─── background theme detection ────────────────────────────────────────────

function detectBg(prompt: string, sceneIndex: number): BgTheme {
  const lower = prompt.toLowerCase();
  if (lower.includes("dark") || lower.includes("night") || lower.includes("shadow")) return "dark";
  if (lower.includes("celebrat") || lower.includes("happy") || lower.includes("party")) return "warm";
  if (lower.includes("school") || lower.includes("work") || lower.includes("office")) return "cool";
  if (lower.includes("angry") || lower.includes("argue") || lower.includes("fight")) return "bold-red";
  // Cycle through themes to give visual variety across scenes
  const rotation: BgTheme[] = ["minimal", "warm", "cool", "bold-blue", "warm", "cool", "minimal", "bold-green"];
  return rotation[sceneIndex % rotation.length];
}

// ─── headline extraction ───────────────────────────────────────────────────

function extractHeadline(scene: Scene, sceneIndex: number): { headline: string; subtext?: string } {
  // Try the visual prompt first — take first clause before comma or period
  const vpClause = scene.visualPrompt.split(/[,.]/).filter(Boolean)[0]?.trim();
  if (vpClause && vpClause.length <= 60) {
    return { headline: vpClause.toUpperCase(), subtext: undefined };
  }
  // Fall back to first sentence of narration text
  const firstSentence = scene.text.split(/[.!?]/)[0]?.trim() ?? "";
  if (firstSentence.length <= 50) {
    return { headline: firstSentence.toUpperCase(), subtext: undefined };
  }
  // Truncate
  const words = firstSentence.split(" ");
  let h = "";
  for (const w of words) {
    if ((h + " " + w).trim().length > 45) break;
    h = (h + " " + w).trim();
  }
  return { headline: h.toUpperCase() || `SCENE ${sceneIndex + 1}` };
}

// ─── character builder ─────────────────────────────────────────────────────

function buildCharacters(
  prompt: string,
  pose: StickmanPose,
  sceneIndex: number,
  characterA?: string,
  characterB?: string
): Character[] {
  const lower = prompt.toLowerCase();

  // Does the prompt reference two characters?
  const hasTwoChars =
    (lower.match(/\band\b/) !== null && (lower.includes("stickman") || lower.includes("person") || lower.includes("character"))) ||
    lower.includes(" vs ") ||
    (characterA !== undefined && characterB !== undefined);

  if (!hasTwoChars) {
    // Single centered character
    return [
      {
        pose,
        color: pickColor(sceneIndex, 0),
        cx: 540,       // horizontal center of 1080px frame
        headY: 1200,
        scale: 1.1,
        flipX: false,
      },
    ];
  }

  // Two characters facing each other, in lower half of frame
  const charAColor: CharacterColor = "blue";
  const charBColor: CharacterColor = "red";

  // Choose poses for left/right characters
  let poseA: StickmanPose = pose;
  let poseB: StickmanPose = pose;

  // Make them face each other or interact
  if (pose === "idle") {
    poseA = "point-right"; // A points at B
    poseB = "point-left";  // B points at A
  } else if (pose === "celebrate") {
    poseA = "celebrate";
    poseB = "celebrate";
  } else if (pose === "question") {
    poseA = "question";
    poseB = "idle";
  }

  return [
    {
      pose: poseA,
      color: charAColor,
      cx: 270,    // left side of 1080px frame
      headY: 1220,
      scale: 0.95,
      flipX: false,
      accessory: sceneIndex % 4 === 0 ? { glasses: true } : undefined,
    },
    {
      pose: poseB,
      color: charBColor,
      cx: 810,    // right side
      headY: 1220,
      scale: 0.95,
      flipX: true,  // mirror so they face left (toward character A)
      accessory: sceneIndex % 4 === 2 ? { hat: true } : undefined,
    },
  ];
}

function pickColor(sceneIndex: number, charIndex: number): CharacterColor {
  const colors: CharacterColor[] = ["blue", "red", "green", "purple", "orange", "black"];
  return colors[(sceneIndex + charIndex) % colors.length];
}

// ─── per-clip motion config ────────────────────────────────────────────────
// Three distinct motion "flavors" cycle across clips so each feels different.
// Inspired by the reference repo's zoom + pan + transition system.

interface ClipMotion {
  zoomFrom: number;
  zoomTo: number;
  panFromX: number;
  panToX: number;
  panFromY: number;
  panToY: number;
  entranceType: EntranceType;
}

const CLIP_MOTIONS: ClipMotion[] = [
  // Clip 0: zoom in + drift right + pop entrance
  { zoomFrom: 1.0, zoomTo: 1.03, panFromX: -15, panToX: 15, panFromY: 0,   panToY: 0,  entranceType: "pop" },
  // Clip 1: zoom out + drift up   + slide-left entrance (from right)
  { zoomFrom: 1.03, zoomTo: 1.0, panFromX: 10,  panToX: -10, panFromY: 10, panToY: -10, entranceType: "slide-left" },
  // Clip 2: zoom in + drift left  + slide-right entrance (from left)
  { zoomFrom: 1.0, zoomTo: 1.03, panFromX: 15,  panToX: -15, panFromY: 0,  panToY: 0,  entranceType: "slide-right" },
];

// ─── main interpreter ─────────────────────────────────────────────────────

/**
 * Converts one Scene into a StickmanSceneConfig ready for compile.ts.
 *
 * @param scene - the script scene
 * @param clipIndex - which clip within the scene (0, 1, 2)
 * @param fps - frames per second (24)
 * @param clipDuration - duration of this clip in seconds
 * @param animStyle - rendering style
 * @param characterA - optional label for character A
 * @param characterB - optional label for character B
 */
export function interpretScene(
  scene: Scene,
  clipIndex: number,
  fps: number,
  clipDuration: number,
  animStyle: AnimStyle = "colorful",
  characterA?: string,
  characterB?: string
): StickmanSceneConfig {
  const prompt = scene.visualPrompt;
  const { headline, subtext } = extractHeadline(scene, scene.index);

  // Vary pose per clip within the same scene
  const basePose = detectPose(prompt);
  const POSE_CYCLE: StickmanPose[] = [basePose, "teach", "celebrate"];
  const pose = POSE_CYCLE[clipIndex % POSE_CYCLE.length];

  const bg = detectBg(prompt, scene.index + clipIndex);
  const characters = buildCharacters(prompt, pose, scene.index + clipIndex, characterA, characterB);
  const frames = Math.round(fps * clipDuration);

  // Pick the motion config for this clip index
  const motion = CLIP_MOTIONS[clipIndex % CLIP_MOTIONS.length];

  return {
    headline,
    subtext,
    bg,
    animStyle,
    characters,
    frames,
    fps,
    zoomFrom: motion.zoomFrom,
    zoomTo: motion.zoomTo,
    panFromX: motion.panFromX,
    panToX: motion.panToX,
    panFromY: motion.panFromY,
    panToY: motion.panToY,
    entranceType: motion.entranceType,
  };
}
