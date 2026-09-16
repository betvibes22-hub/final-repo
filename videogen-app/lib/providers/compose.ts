import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches per-scene visual assets + the full voiceover MP3 into one MP4.
 *
 * Deliberately simple: static scaled/cropped frames, no zoompan (Ken
 * Burns) and no drawtext. Both were tried and both caused crashes on
 * Render's free-tier 512MB instance — zoompan recomputes a full frame
 * for every output frame (720+ frames for a 30s clip), which is far
 * too memory-heavy for this environment; drawtext needs a font file
 * that isn't bundled. Reliability wins over cosmetic polish here —
 * both can be revisited later on a bigger instance or with a bundled
 * font + lighter zoompan settings.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    for (const scene of script.scenes) {
      if (!scene.visualAssetPath) {
        throw new Error(`Scene ${scene.index} has no visualAssetPath — generate visuals first.`);
      }
      const isImage = /\.(svg|png|jpg|jpeg)$/i.test(scene.visualAssetPath);
      if (isImage) {
        command
          .input(scene.visualAssetPath)
          .inputOptions(["-loop 1", `-t ${scene.durationSeconds}`]);
      } else {
        command.input(scene.visualAssetPath).inputOptions([`-t ${scene.durationSeconds}`]);
      }
    }

    const perSceneFilters = script.scenes.map((scene, i) => buildSceneFilter(scene, i));
    const filterInputs = script.scenes.map((_, i) => `[v${i}]`).join("");
    const filterComplex =
      perSceneFilters.join(";") +
      `;${filterInputs}concat=n=${script.scenes.length}:v=1:a=0[outv]`;

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map [outv]",
        `-map ${script.scenes.length}:a`,
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

function buildSceneFilter(scene: { visualAssetPath?: string; durationSeconds: number }, index: number): string {
  const isImage = /\.(svg|png|jpg|jpeg)$/i.test(scene.visualAssetPath!);
  const fps = 24;

  if (isImage) {
    return (
      `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
      `crop=1920:1080,fps=${fps}[v${index}]`
    );
  }

  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=${fps}[v${index}]`
  );
}
