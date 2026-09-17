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

/** Splits a scene's narration into sentences, keeping end punctuation. */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

interface CaptionCue {
  path: string;
  absStart: number;
  absEnd: number;
}

/**
 * One caption cue per SENTENCE, not one per scene — each sentence gets
 * its own on-screen window, sized proportionally to its share of the
 * scene's duration (by character count, a reasonable proxy for how long
 * it takes to say). Earlier, the whole scene's narration (often several
 * sentences) was burned in as one static block for the entire scene,
 * which wrapped into many stacked lines and visually ate half the
 * frame. This is what actually produces "one line, then it clears, then
 * the next sentence" instead of a wall of text.
 */
function buildCaptionCues(script: Script, workDir: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const scene of script.scenes) {
    const sentences = splitSentences(scene.text);
    if (sentences.length === 0) continue;
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;

    let cursor = scene.startSeconds;
    sentences.forEach((sentence, i) => {
      const isLast = i === sentences.length - 1;
      const share = sentence.length / totalChars;
      const absStart = cursor;
      const absEnd = isLast ? scene.startSeconds + scene.durationSeconds : cursor + scene.durationSeconds * share;

      const cuePath = path.join(workDir, `caption-${scene.index}-${i}.txt`);
      fs.writeFileSync(cuePath, wrapCaption(sentence), "utf-8");
      cues.push({ path: cuePath, absStart, absEnd });
      cursor = absEnd;
    });
  }
  return cues;
}

/**
 * Stitches every scene's visual asset(s) + the full voiceover MP3 into
 * one MP4, with burned-in, sentence-timed captions. Each segment can be
 * either a real video clip (Pixabay/illustrated) or a static image
 * (a fallback) — they need different ffmpeg input handling, so each
 * segment carries its type.
 *
 * Captions are applied AFTER the concat, as a chain of drawtext filters
 * keyed to the final timeline via `enable='between(t,start,end)'` —
 * one filter per sentence, each only drawing during its own window —
 * rather than baked into each segment's local filter chain. That
 * decouples captions entirely from however many visual segments a
 * scene has (3 illustrated shots vs 1 video clip vs whatever), which is
 * what a per-segment caption couldn't do cleanly.
 *
 * Captions still use drawtext with `textfile=` rather than inline
 * `text=...` — ffmpeg's filtergraph syntax needs colons, commas, and
 * quotes inside filter option values escaped, and real narration is
 * full of exactly those characters. Reading from a file sidesteps that
 * escaping entirely.
 *
 * Crossfade transitions and Ken Burns motion are still NOT reintroduced
 * here — each is its own separate, isolated, tested change.
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

    const captionCues = buildCaptionCues(script, workDir);

    onLog?.(
      `FFmpeg: compositing ${segments.length} clip(s) across ${script.scenes.length} scene(s)` +
        ` with ${captionCues.length} timed caption(s)`
    );

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
    const concatFilter = `${filterInputs}concat=n=${segments.length}:v=1:a=0[outv]`;

    let lastLabel = "outv";
    const captionFilters = captionCues.map((cue, i) => {
      const nextLabel = `cap${i}`;
      const filter =
        `[${lastLabel}]drawtext=fontfile='${CAPTION_FONT_PATH}':textfile='${cue.path}':` +
        `fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.8:` +
        `x=(w-text_w)/2:y=h-220:line_spacing=6:` +
        `enable='between(t,${cue.absStart.toFixed(2)},${cue.absEnd.toFixed(2)})'[${nextLabel}]`;
      lastLabel = nextLabel;
      return filter;
    });

    const filterComplex = [...perSegmentFilters, concatFilter, ...captionFilters].join(";");

    let lastLoggedPercent = -1;

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        `-map [${lastLabel}]`,
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
