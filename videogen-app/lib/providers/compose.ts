import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import fs from "fs";
import path from "path";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

const TRANSITION_DURATION = 0.4;
const FPS = 24;

/**
 * Stitches every scene's images + the full voiceover MP3 into one MP4.
 *
 * Captions are written to individual .txt files and referenced via
 * ffmpeg's drawtext `textfile=` option, rather than embedding the
 * caption text directly in the filter string. Caption text (real
 * sentences with apostrophes, commas, etc.) contains characters that
 * are special in ffmpeg's own filtergraph syntax, and inline escaping
 * of that was fragile and caused "Invalid argument" filter errors.
 * textfile= sidesteps that entirely — only the file PATH needs
 * escaping, never the caption content.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    const fontPath = path.join(process.cwd(), "assets", "caption-font.ttf");
    const captionsDir = path.join(path.dirname(voiceoverPath), "captions");
    fs.mkdirSync(captionsDir, { recursive: true });

    const segments: { path: string; duration: number; captionFile: string }[] = [];
    for (const scene of script.scenes) {
      const images = scene.visualAssetPaths ?? [];
      if (images.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }

      const captionFile = path.join(captionsDir, `scene-${scene.index}.txt`);
      fs.writeFileSync(captionFile, scene.text.slice(0, 140));

      const perImage = scene.durationSeconds / images.length;
      for (const imagePath of images) {
        segments.push({ path: imagePath, duration: perImage, captionFile });
      }
    }

    for (const seg of segments) {
      command.input(seg.path).inputOptions(["-loop 1", `-t ${seg.duration}`]);
    }

    const scaleFilters = segments.map((seg, i) => buildScaleAndCaptionFilter(seg, i, fontPath));

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

    const filterComplex =
      segments.length === 1
        ? scaleFilters[0].replace("[s0]", "[outv]")
        : [...scaleFilters, ...xfadeFilters].join(";");

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map [outv]",
        `-map ${segments.length}:a`,
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
  seg: { captionFile: string },
  index: number,
  fontPath: string
): string {
  const drawtext =
    `drawtext=fontfile='${escapePath(fontPath)}':textfile='${escapePath(seg.captionFile)}':` +
    `fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=20:` +
    `x=(w-text_w)/2:y=h-220:line_spacing=8`;

  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=${FPS},${drawtext}[s${index}]`
  );
}

// Only file paths pass through this — never arbitrary caption text — so
// this only needs to handle the characters that can appear in a path.
function escapePath(p: string): string {
  return p.replace(/\\/g, "\\\\\\\\").replace(/:/g, "\\:");
}
