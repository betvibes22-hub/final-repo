import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches every scene's images + the full voiceover MP3 into one MP4.
 * Deliberately simple: scale/crop + straight concat, no captions, no
 * crossfade transitions. Both were tried together and both attempts
 * failed with a generic ffmpeg filter-init error — reverted to this
 * known-working baseline rather than guess further. Reintroduce
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

    const segments: { path: string; duration: number }[] = [];
    for (const scene of script.scenes) {
      const images = scene.visualAssetPaths ?? [];
      if (images.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }
      const perImage = scene.durationSeconds / images.length;
      for (const imagePath of images) {
        segments.push({ path: imagePath, duration: perImage });
      }
    }

    for (const seg of segments) {
      command.input(seg.path).inputOptions(["-loop 1", `-t ${seg.duration}`]);
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
