import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Script } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches per-scene visual assets + the full voiceover MP3 into one MP4.
 * Stills get a Ken Burns pan/zoom so they don't sit dead-still on screen.
 *
 * Note: burned-in captions (drawtext) were removed — they need a font
 * file that isn't available on this minimal server image by default and
 * caused "Error initializing complex filters" failures. Can be re-added
 * later with a bundled font file if wanted.
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
  const frames = Math.max(1, Math.round(scene.durationSeconds * fps));

  if (isImage) {
    return (
      `[${index}:v]scale=2208:1242,` +
      `zoompan=z='min(zoom+0.0007,1.15)':d=${frames}:s=1920x1080:fps=${fps}[v${index}]`
    );
  }

  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=${fps}[v${index}]`
  );
}
