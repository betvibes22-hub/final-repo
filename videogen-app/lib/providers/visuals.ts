import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Scene, VideoStyle, VisualAsset, StyleVariant, AspectRatio } from "../types";
import { generateStickmanVisualsForScene } from "./stickman/index";
import type { AnimStyle } from "./stickman/types";

/**
 * Generates visual assets for one scene.
 *
 * ALL styles now produce programmatic stickman animation only.
 * No Pollinations, no Pixabay, no Pexels — stickman is the only
 * visual provider. If stickman fails, a plain colored placeholder
 * frame is returned so the pipeline never crashes.
 */
export async function generateVisualsForScene(
  scene: Scene,
  outDir: string,
  style: VideoStyle = "stickman",
  onLog?: (text: string, service: "pixabay" | "pexels" | "pollinations") => void,
  _styleSeed?: number,
  styleVariant?: StyleVariant,
  _aspectRatio?: AspectRatio,
  characterA?: string,
  characterB?: string
): Promise<VisualAsset[]> {
  fs.mkdirSync(outDir, { recursive: true });
  void style; // always stickman regardless of style selection

  // Map styleVariant to AnimStyle
  const animStyle: AnimStyle =
    styleVariant === "sketchy" ? "classic" :
    styleVariant === "crayon" ? "chunky" :
    "colorful";

  onLog?.(
    `Stickman: generating scene ${scene.index + 1}…`,
    "pollinations"
  );

  try {
    const assets = await generateStickmanVisualsForScene(
      scene, outDir, animStyle, onLog, characterA, characterB
    );
    if (assets.length > 0) return assets;
  } catch (err) {
    console.error(`Stickman failed for scene ${scene.index}:`, err);
    onLog?.(`Stickman error on scene ${scene.index + 1}: ${String(err).slice(0, 120)}`, "pollinations");
  }

  // Absolute last resort: plain colored frame so compose.ts never crashes
  onLog?.(`Stickman: using fallback frame for scene ${scene.index + 1}`, "pollinations");
  return [generateFallbackFrame(scene, outDir)];
}

/**
 * Derives a deterministic seed — kept for pipeline.ts compatibility.
 */
export function deriveStyleSeed(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return hash % 1_000_000;
}

/** Plain solid-color PNG frame — last resort when stickman itself crashes. */
function generateFallbackFrame(scene: Scene, outDir: string): VisualAsset {
  const outPath = path.join(outDir, `scene-${scene.index}-fallback.png`);
  try {
    execFileSync(
      ffmpegPath.path,
      ["-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1080x1920", "-frames:v", "1", outPath],
      { timeout: 15_000 }
    );
  } catch {
    // if ffmpeg itself is broken, compose.ts will deal with the missing file
  }
  return { path: outPath, type: "image" };
}
