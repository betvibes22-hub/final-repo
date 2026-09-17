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
 *
 * `crossfadeShift` accounts for scene-to-scene crossfades shortening
 * the overall timeline: each of the `sceneIndex` transitions before
 * this scene overlaps CROSSFADE_DURATION seconds of it with the
 * previous scene, so this scene's content actually lands
 * `sceneIndex * CROSSFADE_DURATION` seconds earlier in the final output
 * than its original (non-overlapping) script timing says. Passing 0
 * here reproduces the old no-crossfade behavior exactly.
 */
function buildCaptionCues(script: Script, workDir: string, crossfadeDuration: number): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const scene of script.scenes) {
    const sentences = splitSentences(scene.text);
    if (sentences.length === 0) continue;
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
    const shift = scene.index * crossfadeDuration;

    let cursor = scene.startSeconds - shift;
    sentences.forEach((sentence, i) => {
      const isLast = i === sentences.length - 1;
      const share = sentence.length / totalChars;
      const absStart = cursor;
      const absEnd = isLast
        ? scene.startSeconds + scene.durationSeconds - shift
        : cursor + scene.durationSeconds * share;

      const cuePath = path.join(workDir, `caption-${scene.index}-${i}.txt`);
      fs.writeFileSync(cuePath, wrapCaption(sentence), "utf-8");
      cues.push({ path: cuePath, absStart, absEnd });
      cursor = absEnd;
    });
  }
  return cues;
}

// How long each scene-to-scene crossfade takes. Kept short and
// conservative — this is well under the shortest scene we'd ever
// produce (scenes are 15s+ in practice), so there's no risk of a
// transition overlapping more than one scene's own content.
const CROSSFADE_DURATION = 0.5;

/**
 * Stitches every scene's visual asset(s) + the full voiceover MP3 into
 * one MP4, with burned-in, sentence-timed captions and a crossfade
 * between each scene (hard cuts are kept WITHIN a scene, between its
 * own multiple shots — only scene-to-scene boundaries get the fade).
 * Each segment can be either a real video clip (Pixabay/illustrated) or
 * a static image (a fallback) — they need different ffmpeg input
 * handling, so each segment carries its type.
 *
 * Structure: each scene's own segments are concatenated into one
 * `[scene{i}]` sub-stream first, then consecutive scene streams are
 * chained together with `xfade`. Captions are applied AFTER that full
 * chain, keyed to the final (crossfade-shortened) timeline via
 * `enable='between(t,start,end)'` — one filter per sentence — with
 * buildCaptionCues already accounting for how much each crossfade
 * shifts everything earlier.
 *
 * Captions still use drawtext with `textfile=` rather than inline
 * `text=...` — ffmpeg's filtergraph syntax needs colons, commas, and
 * quotes inside filter option values escaped, and real narration is
 * full of exactly those characters. Reading from a file sidesteps that
 * escaping entirely.
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

    // Flat list for ffmpeg -i input ordering, but each carries its
    // scene index so segments can be regrouped per-scene for concat.
    const segments: { asset: VisualAsset; duration: number; sceneIndex: number }[] = [];
    for (const scene of script.scenes) {
      const assets = scene.visualAssetPaths ?? [];
      if (assets.length === 0) {
        throw new Error(`Scene ${scene.index} has no visualAssetPaths — generate visuals first.`);
      }
      const perAsset = scene.durationSeconds / assets.length;
      for (const asset of assets) {
        segments.push({ asset, duration: perAsset, sceneIndex: scene.index });
      }
    }

    // Crossfades are built and ready below, but disabled for now: the
    // bundled @ffmpeg-installer static binary (an old 2018-era build)
    // doesn't have the `xfade` filter compiled in at all — confirmed
    // directly ("No such filter: 'xfade'"), not a bug in this code.
    // Fixing that means upgrading the ffmpeg binary itself, which would
    // need every other filter already relied on here (captions,
    // zoompan, loudnorm) re-verified against the new build before it's
    // safe to ship — a separate, larger piece of work. Hard cuts
    // between scenes in the meantime; shots within a scene were always
    // hard cuts and still are.
    const useCrossfade = false && script.scenes.length > 1;
    const captionCues = buildCaptionCues(script, workDir, useCrossfade ? CROSSFADE_DURATION : 0);

    onLog?.(
      `FFmpeg: compositing ${segments.length} clip(s) across ${script.scenes.length} scene(s)` +
        ` with ${captionCues.length} timed caption(s)${useCrossfade ? " and scene crossfades" : ""}`
    );

    for (const seg of segments) {
      // Video clips: loop indefinitely then trim to the exact segment
      // duration — works whether the source clip is shorter or longer
      // than needed. Images: the classic "-loop 1" still image idiom.
      const inputOptions =
        seg.asset.type === "video"
          ? ["-stream_loop -1", `-t ${seg.duration}`]
          : ["-loop 1", "-r 24", `-t ${seg.duration}`];
      command.input(seg.asset.path).inputOptions(inputOptions);
    }

    const perSegmentFilters = segments.map((seg, i) => buildSegmentFilter(i, seg.asset.type, i));

    // Group segment labels by scene, in scene order, and concat each
    // scene's own shots into one [scene{i}] stream.
    const sceneFilters: string[] = [];
    const sceneLabels: string[] = [];
    for (const scene of script.scenes) {
      const ownLabels = segments
        .map((seg, i) => ({ seg, label: `v${i}` }))
        .filter((x) => x.seg.sceneIndex === scene.index)
        .map((x) => `[${x.label}]`);
      const sceneLabel = `scene${scene.index}`;
      sceneFilters.push(`${ownLabels.join("")}concat=n=${ownLabels.length}:v=1:a=0[${sceneLabel}]`);
      sceneLabels.push(sceneLabel);
    }

    // Chain crossfades between consecutive scenes. offset is measured
    // from the start of the combined-so-far stream; each transition
    // both consumes and re-produces CROSSFADE_DURATION seconds of
    // overlap, which is exactly what buildCaptionCues' shift math above
    // assumes.
    let lastLabel = sceneLabels[0];
    const xfadeFilters: string[] = [];
    if (useCrossfade) {
      let cumulativeLen = script.scenes[0].durationSeconds;
      for (let i = 1; i < script.scenes.length; i++) {
        const offset = cumulativeLen - CROSSFADE_DURATION;
        const nextLabel = `x${i}`;
        xfadeFilters.push(
          `[${lastLabel}][${sceneLabels[i]}]xfade=transition=fade:duration=${CROSSFADE_DURATION}:` +
            `offset=${offset.toFixed(2)}[${nextLabel}]`
        );
        cumulativeLen = cumulativeLen + script.scenes[i].durationSeconds - CROSSFADE_DURATION;
        lastLabel = nextLabel;
      }
    } else if (sceneLabels.length > 1) {
      // Hard-cut fallback: just concat all the per-scene streams
      // together in order, same as the old single-pass concat did.
      const joined = sceneLabels.map((l) => `[${l}]`).join("");
      xfadeFilters.push(`${joined}concat=n=${sceneLabels.length}:v=1:a=0[allscenes]`);
      lastLabel = "allscenes";
    }

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

    // Loudness normalization on the voiceover — brings every video to a
    // consistent, broadcast-standard loudness (-14 LUFS, the same
    // target YouTube/TikTok/Instagram normalize to) instead of whatever
    // raw level Piper/VoiceRSS happened to output. This is a real,
    // audible "professional platform" quality difference.
    const audioFilter = `[${segments.length}:a]loudnorm=I=-14:TP=-1:LRA=11[outa]`;

    const filterComplex = [
      ...perSegmentFilters,
      ...sceneFilters,
      ...xfadeFilters,
      ...captionFilters,
      audioFilter,
    ].join(";");

    let lastLoggedPercent = -1;

    command
      .input(voiceoverPath)
      .complexFilter(filterComplex)
      .outputOptions([
        `-map [${lastLabel}]`,
        `-map [outa]`,
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

/**
 * Real video clips already have their own motion, so they just get
 * scaled/cropped to frame. Static images (illustrated shots + photo
 * fallbacks) get a subtle Ken Burns zoom — this is the filter that
 * caused the earlier OOM crash, so it's built deliberately conservatively:
 *
 * - Moderate upscale (2560x1440, not the 4x+ some Ken Burns tutorials
 *   use) before zoompan gives the crop-in room to work with without
 *   ballooning per-frame memory.
 * - `d=1` with the zoom driven by `on` (zoompan's running output-frame
 *   counter) rather than the more common `d=<total frames>` idiom off a
 *   single held frame. With the image fed continuously at a fixed
 *   `-r 24`, d=1 means "one output frame per input frame, 1:1" — so the
 *   segment's actual output length is exactly however many frames the
 *   `-t` cutoff supplies, with no risk of zoompan producing a different
 *   frame count than expected. That precision matters now more than it
 *   used to: captions are timed to the absolute scene timeline, so any
 *   drift here would desync captions from the video.
 *
 * Zoom style cycles by segment index (in / out / subtle-in) instead of
 * every single shot doing the exact same zoom-in at the exact same
 * rate — small thing, but it's the difference between "every clip
 * clearly ran through the same script" and something that reads as
 * edited. x/y stays centered in every variant (no lateral pan) to keep
 * this low-risk: panning would need bounds-checking against the
 * upscaled canvas that isn't worth the added failure surface here.
 */
// null = static hold (no motion at all — for weight/emphasis on a beat
// that deserves stillness, per real editing practice: not every shot
// should move). Reuses the exact same plain scale/crop path already
// proven for video clips, so it adds zero new risk — no zoompan
// involved at all for this variant.
const MOTION_VARIANTS: (string | null)[] = [
  "min(1+0.0008*on,1.3)", // zoom in, standard rate
  "max(1.3-0.0008*on,1.0)", // zoom out, starts already zoomed in
  "min(1+0.0004*on,1.15)", // zoom in, subtler/slower
  null, // static hold
];

function buildSegmentFilter(index: number, assetType: "video" | "image", globalIndex: number): string {
  const base = `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;

  if (assetType === "video") {
    return `${base},fps=24[v${index}]`;
  }

  const motion = MOTION_VARIANTS[globalIndex % MOTION_VARIANTS.length];
  if (motion === null) {
    return `${base},fps=24[v${index}]`;
  }

  return (
    `${base},scale=2560:1440,` +
    `zoompan=z='${motion}':d=1:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=24[v${index}]`
  );
}
