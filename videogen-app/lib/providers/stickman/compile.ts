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
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { renderFrame } from "./draw";
import { StickmanSceneConfig, StickmanFrameSpec, Character } from "./types";

const execFileAsync = promisify(execFile);

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(t, 1), 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Yields to the event loop so HTTP health-check requests can be
 *  answered between frames — prevents Render from restarting the
 *  server mid-generation when stickman is doing CPU-heavy canvas work. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>(resolve => setImmediate(resolve));
}

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
      bgScene: config.bgScene,
      characters,
      zoomProgress: zoomNorm,
      entranceProgress,
      panX,
      panY,
      slideX,
    };

    const buf = await renderFrame(spec);
    const framePath = path.join(tmpDir, `frame${String(i).padStart(5, "0")}.png`);
    await fs.promises.writeFile(framePath, buf);

    // ── KEY FIX: yield to event loop after every frame ────────────────────
    // Without this, 60 synchronous canvas draws + file writes block Node.js
    // for ~10s per clip, causing Render's HTTP health check to time out →
    // Render marks the instance unhealthy → restarts → kills in-flight jobs.
    // setImmediate lets pending HTTP callbacks (health checks, etc.) run
    // between frames, so the server stays responsive throughout encoding.
    await yieldToEventLoop();

    if (i % 10 === 0) {
      onLog?.(`Stickman: frame ${i + 1}/${frames}`);
    }
  }

  onLog?.(`Stickman: encoding MP4…`);

  // execFileAsync (vs execFileSync) keeps the event loop alive during
  // ffmpeg encoding, so health checks continue to be answered.
  const pattern = path.join(tmpDir, "frame%05d.png");
  await execFileAsync(
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
