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
  outputPath: string
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

function buildSegmentFilter(index: number): string {
  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=24[v${index}]`
  );
}
