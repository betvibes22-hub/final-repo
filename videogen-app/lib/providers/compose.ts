import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Script, VisualAsset } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches every scene's visual asset(s) + the full voiceover MP3 into
 * one MP4. Each segment can be either a real video clip (Pixabay) or a
 * static image (a fallback when no video match existed) — they need
 * different ffmpeg input handling, so each segment carries its type.
 *
 * Deliberately simple otherwise: scale/crop + straight concat, no
 * captions, no crossfade transitions. Both were tried together once
 * before and failed with a generic ffmpeg filter-init error — reverted
 * to this known-working baseline rather than guess further. Reintroduce
 * captions and crossfades ONE AT A TIME, each verified working on its
 * own, before combining them again.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string,
  onLog?: (text: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    const segments: { asset: VisualAsset; duration: number }[] = [];
    for (const scene of script.scenes) {
      const assets = scene.visualAssetPaths ?? [];
      if (assets.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }
      const perAsset = scene.durationSeconds / assets.length;
      for (const asset of assets) {
        segments.push({ asset, duration: perAsset });
      }
    }

    onLog?.(`FFmpeg: compositing ${segments.length} clip(s) across ${script.scenes.length} scene(s)`);

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

    const perSegmentFilters = segments.map((_, i) => buildSegmentFilter(i));
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

function buildSegmentFilter(index: number): string {
  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=24[v${index}]`
  );
}
