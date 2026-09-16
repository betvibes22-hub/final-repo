import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "path";
import { Script, Scene } from "../types";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Stitches per-scene visual assets + the full voiceover MP3 into one MP4.
 *
 * - Real video clips (from Pexels) play as-is, trimmed to the scene's
 *   duration — genuine motion, no extra processing needed.
 * - Still photos/placeholders get a Ken Burns pan/zoom applied so they
 *   don't sit dead-still on screen — this alone makes a huge difference
 *   in whether it "feels like a video."
 * - Scene narration text is burned in as a caption at the bottom of
 *   every scene, video or still, so visuals always carry context.
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
        // Real video clip — trim to the scene's duration.
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

/**
 * Builds the per-input filter chain for one scene:
 * - Stills get scaled up slightly + a slow zoompan (Ken Burns effect).
 * - Real video clips just get scaled/cropped to the standard frame.
 * Either way, the scene's narration text is burned in as a caption.
 */
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
    // Scale up 15% beyond frame so the zoompan has room to pan without
    // showing edges, then slow zoom-in over the scene's duration.
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
  // ffmpeg drawtext needs these characters escaped inside single quotes.
  return s
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}
