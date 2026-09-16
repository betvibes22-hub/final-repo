import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "path";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches per-scene visual assets + the full voiceover MP3 into one MP4.
 * Each scene's image/video is shown for its durationSeconds, in order,
 * with the voiceover playing underneath the whole thing.
 *
 * NOTE: this is a straightforward "slideshow + audio" composition.
 * For real video-clip scenes (not static images), each scene's own clip
 * plays instead of a still frame — fluent-ffmpeg handles both the same way
 * via concat, as long as each input already matches its target duration.
 */
export async function composeVideo(
  script: Script,
  voiceoverPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add each scene's visual, trimmed/looped to its scene duration.
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
        command.input(scene.visualAssetPath);
      }
    }

    // Concat all scene inputs into one video stream, then mux with voiceover.
    const filterInputs = script.scenes.map((_, i) => `[${i}:v]`).join("");
    const filterComplex = `${filterInputs}concat=n=${script.scenes.length}:v=1:a=0[outv]`;

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map [outv]",
        `-map ${script.scenes.length}:a`, // voiceover is the last input
        "-c:v libx264",
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
