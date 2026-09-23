/**
 * Main entry point for programmatic stickman video generation.
 *
 * Called from visuals.ts when style === "stickman".
 * Generates CLIPS_PER_SCENE animated MP4 clips for one scene,
 * then crossfades them into a single smooth output clip.
 *
 * Returns VisualAsset[] with type: "video" so compose.ts loops it
 * to fill the scene's full duration.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Scene, VisualAsset } from "../../types";
import { interpretScene } from "./interpreter";
import { compileScene } from "./compile";
import { AnimStyle } from "./types";

const execFileAsync = promisify(execFile);

const CLIPS_PER_SCENE = 3;
const FPS = 24;

// Each stickman clip is this many seconds long
const CLIP_DURATION_SECONDS = 2.5;

// Crossfade overlap between clips (seconds)
const CROSS_DURATION = 0.25;

/**
 * Concatenate multiple clips into one video using FFmpeg concat filter.
 * Uses the concat filter (available since ancient FFmpeg) instead of xfade
 * (which requires FFmpeg 4.3+, not available in the bundled 2018 build).
 *
 * Returns the path of the combined clip, or null if concat fails
 * (caller falls back to returning the separate clips).
 */
async function crossfadeClips(
  clipPaths: string[],
  sceneIndex: number,
  outDir: string,
  onLog?: (msg: string) => void
): Promise<string | null> {
  if (clipPaths.length <= 1) return clipPaths[0] ?? null;

  const args: string[] = ["-y"];
  for (const p of clipPaths) {
    args.push("-i", p);
  }

  // Build concat filter — works in all FFmpeg versions, no xfade needed
  // e.g. 3 clips: [0][1][2]concat=n=3:v=1:a=0[vout]
  const inputs = clipPaths.map((_, i) => `[${i}]`).join("");
  const filterComplex = `${inputs}concat=n=${clipPaths.length}:v=1:a=0[vout]`;

  const combinedPath = path.join(outDir, `scene-${sceneIndex}-stickman-combined.mp4`);
  onLog?.(`Stickman: concatenating ${clipPaths.length} clips…`);

  try {
    // execFileAsync keeps the event loop alive during ffmpeg encoding
    await execFileAsync(
      ffmpegPath.path,
      [
        ...args,
        "-filter_complex", filterComplex,
        "-map", "[vout]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        combinedPath,
      ],
      { timeout: 180_000 }
    );
    onLog?.(`Stickman: combined clip ready (${clipPaths.length} clips joined)`);
    return combinedPath;
  } catch (err) {
    console.error(`Stickman: concat failed for scene ${sceneIndex}:`, err);
    onLog?.(`Stickman: concat failed — returning separate clips`);
    return null;
  }
}

/**
 * Generate animated stickman video clips for one scene.
 *
 * @param scene - script scene (has visualPrompt, text, durationSeconds, index)
 * @param outDir - directory to write MP4s into
 * @param animStyle - visual rendering style (colorful, classic, dark, chunky)
 * @param onLog - optional progress callback
 * @param characterA - optional label/name for character A
 * @param characterB - optional label/name for character B
 */
export async function generateStickmanVisualsForScene(
  scene: Scene,
  outDir: string,
  animStyle: AnimStyle = "colorful",
  onLog?: (text: string, service: "pollinations") => void,
  characterA?: string,
  characterB?: string
): Promise<VisualAsset[]> {
  fs.mkdirSync(outDir, { recursive: true });

  const clipPaths: string[] = [];
  const log = (msg: string) => onLog?.(msg, "pollinations");

  // Generate each clip
  for (let clipIndex = 0; clipIndex < CLIPS_PER_SCENE; clipIndex++) {
    const config = interpretScene(
      scene,
      clipIndex,
      FPS,
      CLIP_DURATION_SECONDS,
      animStyle,
      characterA,
      characterB
    );

    const outPath = path.join(outDir, `scene-${scene.index}-stickman-${clipIndex}.mp4`);

    try {
      log(`Stickman: generating clip ${clipIndex + 1}/${CLIPS_PER_SCENE} for scene ${scene.index + 1}`);
      await compileScene(config, outPath, log);
      clipPaths.push(outPath);
    } catch (err) {
      console.error(`Stickman clip ${clipIndex} for scene ${scene.index} failed:`, err);
      // Skip this clip — fewer clips still crossfade fine
    }
  }

  if (clipPaths.length === 0) {
    log(`Stickman: all clips failed for scene ${scene.index + 1}, falling back to placeholder`);
    return [];
  }

  // Crossfade the clips into one smooth video
  const combined = await crossfadeClips(clipPaths, scene.index, outDir, log);

  if (combined) {
    // Clean up the individual clip files — the combined version is all we need
    for (const p of clipPaths) {
      try { fs.unlinkSync(p); } catch { /* best-effort */ }
    }
    log(`Stickman: scene ${scene.index + 1} ready with smooth transitions`);
    return [{ path: combined, type: "video" }];
  }

  // xfade failed — return separate clips (compose.ts loops them individually)
  log(`Stickman: ${clipPaths.length} clip(s) ready for scene ${scene.index + 1}`);
  return clipPaths.map((p) => ({ path: p, type: "video" as const }));
}
