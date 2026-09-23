/**
 * Interprets a scene's visual prompt into a StickmanSceneConfig.
 *
 * Uses keyword matching on the visualPrompt + narration text to decide:
 *  - How many characters (1 or 2)
 *  - What pose each character should hold
 *  - Which character color (A = blue, B = red)
 *  - Background color theme
 *  - Scene environment (outdoor / city / indoor / night / tech / beach / default)
 *  - Headline text + narration subtext caption
 *  - Per-clip motion: zoom direction, camera pan, entrance type
 */

import { Scene } from "../../types";
import {
  AnimStyle,
  BgScene,
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
  const rotation: BgTheme[] = ["minimal", "warm", "cool", "bold-blue", "warm", "cool", "minimal", "bold-green"];
  return rotation[sceneIndex % rotation.length];
}

// ─── scene environment detection ──────────────────────────────────────────

/**
 * Detects the scene's physical environment from the prompt + narration text.
 * Drives rich background scenery in draw.ts (trees, buildings, monitors, etc.).
 */
function detectBgScene(prompt: string, sceneText: string): BgScene {
  const lower = (prompt + " " + sceneText).toLowerCase();

  if (
    lower.includes("outdoor") || lower.includes("outside") || lower.includes("park") ||
    lower.includes("garden") || lower.includes("forest") || lower.includes("tree") ||
    lower.includes("nature") || lower.includes("field") || lower.includes("meadow") ||
    lower.includes("grass") || lower.includes("hiking") || lower.includes("trail") ||
    lower.includes("backyard") || lower.includes("yard") || lower.includes("lawn") ||
    lower.includes("green") || lower.includes("mountain")
  ) return "outdoor";

  if (
    lower.includes("beach") || lower.includes("ocean") || lower.includes(" sea ") ||
    lower.includes("swim") || lower.includes("surf") || lower.includes("coast") ||
    lower.includes("sand") || lower.includes("waves") || lower.includes("tropical") ||
    lower.includes("lake") || lower.includes("river")
  ) return "beach";

  if (
    lower.includes("night") || lower.includes("evening") || lower.includes("midnight") ||
    lower.includes("after dark") || lower.includes("stars") || lower.includes("moonlight") ||
    lower.includes("dusk") || lower.includes("dark sky")
  ) return "night";

  if (
    lower.includes("tech") || lower.includes("phone") || lower.includes("iphone") ||
    lower.includes("android") || lower.includes("computer") || lower.includes("laptop") ||
    lower.includes("software") || lower.includes("app ") || lower.includes("digital") ||
    lower.includes("internet") || lower.includes(" ai ") || lower.includes("data") ||
    lower.includes("cod") || lower.includes("screen") || lower.includes("device") ||
    lower.includes("gadget") || lower.includes("robot") || lower.includes("program") ||
    lower.includes("website") || lower.includes("online") || lower.includes("social media") ||
    lower.includes("tiktok") || lower.includes("youtube") || lower.includes("instagram")
  ) return "tech";

  if (
    lower.includes("city") || lower.includes("urban") || lower.includes("street") ||
    lower.includes("downtown") || lower.includes("skyline") || lower.includes("skyscraper") ||
    lower.includes("building") || lower.includes("apartment") || lower.includes("neighborhood") ||
    lower.includes("traffic") || lower.includes("subway") || lower.includes("downtown")
  ) return "city";

  if (
    lower.includes("indoor") || lower.includes("inside") || lower.includes("room") ||
    lower.includes("home") || lower.includes("house") || lower.includes("living") ||
    lower.includes("kitchen") || lower.includes("bedroom") || lower.includes("office") ||
    lower.includes("school") || lower.includes("classroom") || lower.includes("library") ||
    lower.includes("work") || lower.includes("desk") || lower.includes("wall") ||
    lower.includes("furniture") || lower.includes("couch") || lower.includes("chair") ||
    lower.includes("shelf") || lower.includes("store") || lower.includes("restaurant")
  ) return "indoor";

  return "default";
}

// ─── headline + narration extraction ─────────────────────────────────────

function extractHeadline(scene: Scene, sceneIndex: number): { headline: string; subtext?: string } {
  // Extract narration text from scene.text (first 1–2 sentences) for the caption bar
  const rawSentences = scene.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
  const firstSentence = rawSentences[0] ?? "";
  const secondSentence = rawSentences[1] ?? "";

  // Build narration caption: first sentence, optionally extend with second
  let narration = firstSentence;
  if (narration.length < 80 && secondSentence && (narration + secondSentence).length < 160) {
    narration = narration + ". " + secondSentence;
  }
  if (narration.length > 150) {
    narration = narration.substring(0, 147) + "...";
  }
  const subtext = narration.length > 8 ? narration : undefined;

  // Headline: try first clause of visualPrompt
  const vpClause = scene.visualPrompt.split(/[,.]/).filter(Boolean)[0]?.trim();
  if (vpClause && vpClause.length <= 60) {
    return { headline: vpClause.toUpperCase(), subtext };
  }
  // Fall back to first sentence of narration text
  if (firstSentence.length <= 50) {
    return { headline: firstSentence.toUpperCase(), subtext };
  }
  // Truncate
  const words = firstSentence.split(" ");
  let h = "";
  for (const w of words) {
    if ((h + " " + w).trim().length > 45) break;
    h = (h + " " + w).trim();
  }
  return { headline: h.toUpperCase() || `SCENE ${sceneIndex + 1}`, subtext };
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

  // Broadened two-character detection: conversations, comparisons, any interaction
  const hasTwoChars =
    (characterA !== undefined && characterB !== undefined) ||
    lower.includes(" vs ") ||
    lower.includes(" versus ") ||
    lower.includes("compare") ||
    lower.includes("both") ||
    lower.includes("together") ||
    lower.includes("each other") ||
    lower.includes("conversation") ||
    lower.includes("dialog") ||
    lower.includes("dialogue") ||
    lower.includes("discuss") ||
    lower.includes("debate") ||
    lower.includes("friend") ||
    lower.includes("partner") ||
    lower.includes("couple") ||
    lower.includes(" two ") ||
    lower.includes("people") ||
    lower.includes("them ") ||
    lower.includes("they ") ||
    (lower.match(/\band\b/) !== null && (
      lower.includes("stickman") ||
      lower.includes("character") ||
      lower.includes("person") ||
      lower.includes("guy") ||
      lower.includes("man") ||
      lower.includes("woman") ||
      lower.includes("student") ||
      lower.includes("teacher") ||
      lower.includes("boss") ||
      lower.includes("employee") ||
      lower.includes("kid") ||
      lower.includes("child")
    ));

  if (!hasTwoChars) {
    // Single centered character
    return [
      {
        pose,
        color: pickColor(sceneIndex, 0),
        cx: 540,
        headY: 1200,
        scale: 1.1,
        flipX: false,
      },
    ];
  }

  // Two characters facing each other
  const charAColor: CharacterColor = "blue";
  const charBColor: CharacterColor = "red";

  let poseA: StickmanPose = pose;
  let poseB: StickmanPose = pose;

  if (pose === "idle") {
    poseA = "point-right";
    poseB = "point-left";
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
      cx: 270,
      headY: 1220,
      scale: 0.95,
      flipX: false,
      accessory: sceneIndex % 4 === 0 ? { glasses: true } : undefined,
    },
    {
      pose: poseB,
      color: charBColor,
      cx: 810,
      headY: 1220,
      scale: 0.95,
      flipX: true,
      accessory: sceneIndex % 4 === 2 ? { hat: true } : undefined,
    },
  ];
}

function pickColor(sceneIndex: number, charIndex: number): CharacterColor {
  const colors: CharacterColor[] = ["blue", "red", "green", "purple", "orange", "black"];
  return colors[(sceneIndex + charIndex) % colors.length];
}

// ─── per-clip motion config ────────────────────────────────────────────────

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
  { zoomFrom: 1.0, zoomTo: 1.03, panFromX: -15, panToX: 15,  panFromY: 0,   panToY: 0,   entranceType: "pop" },
  { zoomFrom: 1.03, zoomTo: 1.0, panFromX: 10,  panToX: -10, panFromY: 10,  panToY: -10, entranceType: "slide-left" },
  { zoomFrom: 1.0, zoomTo: 1.03, panFromX: 15,  panToX: -15, panFromY: 0,   panToY: 0,   entranceType: "slide-right" },
];

// ─── main interpreter ─────────────────────────────────────────────────────

/**
 * Converts one Scene into a StickmanSceneConfig ready for compile.ts.
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
  const bgScene = detectBgScene(prompt, scene.text);
  const characters = buildCharacters(prompt, pose, scene.index + clipIndex, characterA, characterB);
  const frames = Math.round(fps * clipDuration);

  const motion = CLIP_MOTIONS[clipIndex % CLIP_MOTIONS.length];

  return {
    headline,
    subtext,
    bg,
    bgScene,
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
