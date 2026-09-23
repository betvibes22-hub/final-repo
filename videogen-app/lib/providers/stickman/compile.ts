/**
 * Compiles a stickman scene config into an MP4 file by:
 *   1. Rendering each frame to a PNG buffer via draw.ts
 *   2. Writing PNGs to a temp directory
 *   3. Encoding them into MP4 via FFmpeg PNG-sequence input
 *
 * Returns the path to the output MP4.
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { renderFrame } from "./draw";
import { StickmanSceneConfig, StickmanFrameSpec, Character } from "./types";

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(t, 1), 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Render all frames of a scene and encode to MP4.
 */
export async function compileScene(
  config: StickmanSceneConfig,
  outputPath: string,
  onLog?: (msg: string) => void
): Promise<string> {
  const {
    frames, fps,
    zoomFrom = 1, zoomTo = 1.03,
    panFromX = 0, panToX = 0,
    panFromY = 0, panToY = 0,
    entranceType = "pop",
  } = config;

  const tmpDir = path.join(path.dirname(outputPath), "_frames_" + path.basename(outputPath, ".mp4"));
  fs.mkdirSync(tmpDir, { recursive: true });

  onLog?.(`Stickman: rendering ${frames} frames at ${fps}fps…`);

  // Entrance: first 40% of 1 second = pop or slide in
  const ENTRANCE_FRAMES = Math.round(fps * 0.4);
  // Slide distance in pixels (travels from full-offset down to 0)
  const SLIDE_DIST = 160;

  for (let i = 0; i < frames; i++) {
    const progress = frames > 1 ? i / (frames - 1) : 0;

    // ── Ken Burns zoom ──────────────────────────────────────────────────────
    const zoomScale = lerp(zoomFrom, zoomTo, progress);
    const zoomNorm = zoomFrom === zoomTo ? 0 : (zoomScale - zoomFrom) / (zoomTo - zoomFrom);

    // ── Entrance (pop or slide) ─────────────────────────────────────────────
    const entranceProgress = i < ENTRANCE_FRAMES ? i / ENTRANCE_FRAMES : 1;

    let slideX = 0;
    if (i < ENTRANCE_FRAMES) {
      const ep = easeOut(i / ENTRANCE_FRAMES);
      if (entranceType === "slide-left") {
        slideX = (1 - ep) * SLIDE_DIST;   // slides in from the right
      } else if (entranceType === "slide-right") {
        slideX = -(1 - ep) * SLIDE_DIST;  // slides in from the left
      }
      // "pop" uses entranceProgress scale in draw.ts — no extra slideX
    }

    // ── Camera pan (slow drift, from reference repo motion concepts) ────────
    const panX = lerp(panFromX, panToX, progress);
    const panY = lerp(panFromY, panToY, progress);

    // ── Limb oscillation phase ──────────────────────────────────────────────
    const animPhase = (i / fps) % 1;

    const characters: Character[] = config.characters.map((c) => ({
      ...c,
      animPhase,
    }));

    const spec: StickmanFrameSpec = {
      width: 1080,
      height: 1920,
      bg: config.bg,
      animStyle: config.animStyle,
      headline: config.headline,
      subtext: config.subtext,
      characters,
      zoomProgress: zoomNorm,
      entranceProgress,
      panX,
      panY,
      slideX,
    };

    const buf = await renderFrame(spec);
    const framePath = path.join(tmpDir, `frame${String(i).padStart(5, "0")}.png`);
    fs.writeFileSync(framePath, buf);

    if (i % 10 === 0) {
      onLog?.(`Stickman: frame ${i + 1}/${frames}`);
    }
  }

  onLog?.(`Stickman: encoding MP4…`);

  const pattern = path.join(tmpDir, "frame%05d.png");
  execFileSync(
    ffmpegPath.path,
    [
      "-y",
      "-framerate", String(fps),
      "-i", pattern,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ],
    { timeout: 120_000 }
  );

  // Clean up frames
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // cleanup is best-effort
  }

  onLog?.(`Stickman: MP4 ready — ${path.basename(outputPath)}`);
  return outputPath;
}
