import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "path";
import { Script, Scene } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

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

function buildSceneFilter(scene: Scene, index: number): string {
  const isImage = /\.(svg|png|jpg|jpeg)$/i.test(scene.visualAssetPath!);
  const fps = 24;
  const frames = Math.max(1, Math.round(scene.durationSeconds * fps));
  const caption = escapeForDrawtext(scene.text.slice(0, 140));

  const drawtext =
    `drawtext=text='${caption}':fontcolor=white:fontsize=42:` +
    `box=1:boxcolor=black@0.55:boxborderw=20:` +
    `x=(w-text_w)/2:y=h-220:line_spacing=8`;

  if (isImage) {
    return (
      `[${index}:v]scale=2208:1242,` +
      `zoompan=z='min(zoom+0.0007,1.15)':d=${frames}:s=1920x1080:fps=${fps},` +
      `${drawtext}[v${index}]`
    );
  }

  return (
    `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,fps=${fps},${drawtext}[v${index}]`
  );
}

function escapeForDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}
