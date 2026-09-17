import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Script, VisualAsset } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

const CAPTION_FONT_PATH = path.join(process.cwd(), "assets", "caption-font.ttf");

/** Wraps narration text to a max line width so drawtext doesn't run off the frame. */
function wrapCaption(text: string, maxCharsPerLine = 42): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/**
 * Stitches every scene's visual asset(s) + the full voiceover MP3 into
 * one MP4, with burned-in captions. Each segment can be either a real
 * video clip (Pixabay) or a static image (a fallback when no video
 * match existed) — they need different ffmpeg input handling, so each
 * segment carries its type.
 *
 * Captions use drawtext with `textfile=` (one small .txt per scene)
 * rather than passing the narration inline as `text=...` — ffmpeg's
 * filtergraph syntax needs colons, commas, and quotes inside filter
 * option values escaped, and real narration text is full of exactly
 * those characters. Reading from a file sidesteps that escaping
 * entirely, which is almost certainly what caused the earlier generic
 * filter-init error when captions were first tried.
 *
 * Crossfade transitions were reverted alongside captions before and
 * are NOT reintroduced here — that's a separate, isolated change to
 * verify on its own once captions alone are confirmed stable.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string,
  onLog?: (text: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    const workDir = path.dirname(outputPath);

    const segments: { asset: VisualAsset; duration: number; captionPath: string }[] = [];
    for (const scene of script.scenes) {
      const assets = scene.visualAssetPaths ?? [];
      if (assets.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }

      const captionPath = path.join(workDir, `caption-${scene.index}.txt`);
      fs.writeFileSync(captionPath, wrapCaption(scene.text), "utf-8");

      const perAsset = scene.durationSeconds / assets.length;
      for (const asset of assets) {
        segments.push({ asset, duration: perAsset, captionPath });
      }
    }

    onLog?.(`FFmpeg: compositing ${segments.length} clip(s) across ${script.scenes.length} scene(s) with captions`);

    for (const seg of segments) {
      // Video clips: loop indefinitely then trim to the exact segment
      // duration — works whether the source clip is shorter or longer
      // than needed. Images: the classic "-loop 1" still image idiom.
      const inputOptions =
        seg.asset.type === "video"
          ? ["-stream_loop -1", `-t ${seg.duration}`]
          : ["-loop 1", `-t ${seg.duration}`];
      command.input(seg.asset.path).inputOptions(inputOptions);
    }

    const perSegmentFilters = segments.map((seg, i) => buildSegmentFilter(i, seg.captionPath));
    const filterInputs = segments.map((_, i) => `[v${i}]`).join("");
    const filterComplex =
      perSegmentFilters.join(";") +
      `;${filterInputs}concat=n=${segments.length}:v=1:a=0[outv]`;

    let lastLoggedPercent = -1;

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map [outv]",
        `-map ${segments.length}:a`,
        "-c:v libx264",
        // Quality over speed: the pipeline isn't racing an HTTP timeout
        // (generation runs in the background, the frontend polls for
        // status), so there's no reason to trade encode quality away
        // for raw speed here. "slow" + a lower CRF meaningfully improves
        // detail and compression efficiency over the old "ultrafast"
        // default without materially increasing memory use — x264
        // presets trade CPU time, not RAM, for quality.
        "-preset slow",
        "-crf 18",
        "-c:a aac",
        "-b:a 192k",
        "-pix_fmt yuv420p",
        "-shortest",
      ])
      .output(outputPath)
      .on("progress", (p) => {
        const percent = Math.round(p.percent ?? 0);
        if (percent >= lastLoggedPercent + 20 && percent > 0) {
          lastLoggedPercent = percent;
          onLog?.(`FFmpeg: encoding final cut — ${Math.min(percent, 100)}%`);
        }
      })
      .on("end", () => {
        onLog?.("FFmpeg: final cut encoded");
        resolve(outputPath);
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

function buildSegmentFilter(index: number, captionPath: string): string {
  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=24,` +
    `drawtext=fontfile='${CAPTION_FONT_PATH}':textfile='${captionPath}':` +
    `fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.8:` +
    `x=(w-text_w)/2:y=h-220:line_spacing=6[v${index}]`
  );
}
