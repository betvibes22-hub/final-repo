import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "path";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

const TRANSITION_DURATION = 0.4; // seconds, soft crossfade between images
const FPS = 24;

/**
 * Stitches every scene's images + the full voiceover MP3 into one MP4.
 *
 * - Multiple images per scene, crossfaded between (not hard cuts) using
 *   ffmpeg's real xfade filter.
 * - Captions burned in using a bundled TTF font file (assets/caption-font.ttf)
 *   — a font file is required for drawtext to work at all, and the
 *   server has no default one; bundling our own fixes that for good.
 *
 * No zoompan — that crashed the free-tier server's memory earlier.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    const fontPath = path.join(process.cwd(), "assets", "caption-font.ttf");

    const segments: { path: string; duration: number; caption: string }[] = [];
    for (const scene of script.scenes) {
      const images = scene.visualAssetPaths ?? [];
      if (images.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }
      const perImage = scene.durationSeconds / images.length;
      for (const imagePath of images) {
        segments.push({ path: imagePath, duration: perImage, caption: scene.text });
      }
    }

    for (const seg of segments) {
      command.input(seg.path).inputOptions(["-loop 1", `-t ${seg.duration}`]);
    }

    // Step 1: scale/crop + caption every segment individually.
    const scaleFilters = segments.map((seg, i) => buildScaleAndCaptionFilter(seg, i, fontPath));

    // Step 2: chain crossfades pairwise — each xfade consumes the running
    // total and the next clip, offset so the fade starts just before the
    // running clip ends.
    let cumulativeDuration = segments[0].duration;
    let lastLabel = "s0";
    const xfadeFilters: string[] = [];

    for (let i = 1; i < segments.length; i++) {
      const offset = Math.max(0, cumulativeDuration - TRANSITION_DURATION);
      const outLabel = i === segments.length - 1 ? "outv" : `x${i}`;
      xfadeFilters.push(
        `[${lastLabel}][s${i}]xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset.toFixed(2)}[${outLabel}]`
      );
      cumulativeDuration += segments[i].duration - TRANSITION_DURATION;
      lastLabel = outLabel;
    }

    // If there's only one segment, no xfade needed — just relabel it.
    const filterComplex =
      segments.length === 1
        ? `${scaleFilters[0].replace("[s0]", "[outv]")}`
        : [...scaleFilters, ...xfadeFilters].join(";");

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map [outv]",
        `-map ${segments.length}:a`, // voiceover is the last input
        "-c:v libx264",
        "-preset ultrafast",
        "-c:a aac",
        "-pix_fmt yuv420p",
        "-shortest",
      ])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

function buildScaleAndCaptionFilter(
  seg: { caption: string },
  index: number,
  fontPath: string
): string {
  const caption = escapeForDrawtext(seg.caption.slice(0, 140));
  const drawtext =
    `drawtext=fontfile='${fontPath}':text='${caption}':fontcolor=white:fontsize=42:` +
    `box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-220:line_spacing=8`;

  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=${FPS},${drawtext}[s${index}]`
  );
}

function escapeForDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}
