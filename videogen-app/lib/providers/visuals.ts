import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { Scene, VideoStyle, VisualAsset, StyleVariant } from "../types";
import { downloadToFile } from "./download";

// Multiple clips cut between per scene, matching the faster short-form
// pace the old AI-image approach had (3 images/scene) — a single long
// static shot per scene read as slow/boring, so we cut more often even
// though each clip already has its own motion.
const CLIPS_PER_SCENE = 3;

/**
 * Generates the visual assets for one scene — real stock video clips
 * by default, cut between every couple seconds so it feels edited,
 * short-form-paced, not a single static shot per beat.
 *
 * Primary source: Pixabay's video API — genuinely free (just a signup
 * key, no card), CC-style commercial-use license, no attribution
 * required.
 *
 * Falls back to Pixabay photos (same free key) if there aren't enough
 * video matches, then Pexels photos, then a placeholder — so a scene
 * always gets something even if real footage wasn't available.
 */
export async function generateVisualsForScene(
  scene: Scene,
  outDir: string,
  style: VideoStyle = "realistic",
  onLog?: (text: string, service: "pixabay" | "pexels" | "pollinations") => void,
  styleSeed?: number,
  styleVariant?: StyleVariant
): Promise<VisualAsset[]> {
  if (style !== "realistic") {
    return generateIllustratedVisualsForScene(scene, outDir, style, onLog, styleSeed, styleVariant);
  }

  const pixabayKey = process.env.PIXABAY_API_KEY;
  const log = (text: string, service: "pixabay" | "pexels") => onLog?.(text, service);

  if (pixabayKey) {
    try {
      log(`Pixabay: searching video library for scene ${scene.index + 1} — "${searchQuery(scene)}"`, "pixabay");
      const assets = await fetchPixabayVideos(scene, outDir, pixabayKey, CLIPS_PER_SCENE);
      if (assets.length > 0) {
        log(`Pixabay: downloaded ${assets.length} video clip(s) for scene ${scene.index + 1}`, "pixabay");
        return assets;
      }
      log(`Pixabay: no video matches for scene ${scene.index + 1}, trying photos`, "pixabay");
    } catch (err) {
      console.error(`Pixabay video failed for scene ${scene.index}, trying Pixabay photos:`, err);
      log(`Pixabay: video search failed for scene ${scene.index + 1}, trying photos`, "pixabay");
    }

    try {
      const assets = await fetchPixabayPhotos(scene, outDir, pixabayKey, CLIPS_PER_SCENE);
      if (assets.length > 0) {
        log(`Pixabay: downloaded ${assets.length} photo(s) for scene ${scene.index + 1}`, "pixabay");
        return assets;
      }
    } catch (err) {
      console.error(`Pixabay photos failed for scene ${scene.index}, trying Pexels:`, err);
      log(`Pixabay: photo fallback failed for scene ${scene.index + 1}, trying Pexels`, "pixabay");
    }
  }

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      log(`Pexels: searching photo library for scene ${scene.index + 1} — "${searchQuery(scene)}"`, "pexels");
      const assets = await fetchPexelsPhotos(scene, outDir, pexelsKey, CLIPS_PER_SCENE);
      if (assets.length > 0) {
        log(`Pexels: downloaded ${assets.length} photo(s) for scene ${scene.index + 1}`, "pexels");
        return assets;
      }
    } catch (err) {
      console.error(`Pexels photos failed for scene ${scene.index}, falling back to placeholder:`, err);
      log(`Pexels: search failed for scene ${scene.index + 1}, using placeholder`, "pexels");
    }
  }

  return [generatePlaceholderFrame(scene, outDir)];
}

function searchQuery(scene: Scene): string {
  return scene.visualPrompt.split(",")[0].split(".")[0].trim().slice(0, 60);
}

const STYLE_PROMPT_SUFFIX: Record<Exclude<VideoStyle, "realistic">, string> = {
  "whiteboard-doodle":
    "hand-drawn doodle sketch, whiteboard marker illustration, black ink line art on plain white background, simple explainer-video style, no color, highly detailed linework, professional illustration",
  cartoon:
    "flat 2D cartoon illustration, bold clean outlines, vibrant simple colors, animated explainer-video style, highly detailed, professional character design, rich background detail",
  // Strict construction rules so every generated frame reads as the
  // same recognizable "brand" of character, not a different loose
  // doodle style each time: circle head, no neck, two small dot eyes,
  // thin eyebrows, one curved line for the mouth, thin uniform stick
  // limbs, rounded mitten hands/feet (no fingers/toes), flat solid
  // color fills only — no gradients, no shading, no texture.
  stickman:
    "minimalist flat-color stickman doodle explainer style: perfect circle head with no neck, two small black dot eyes, thin black eyebrows, a single curved black line for the mouth, thin uniform black stick limbs, rounded black mitten hands with no fingers, rounded black mitten feet with no toes, flat solid color fills only, no gradients, no shading, no texture, clean uniform thin line weight, simple 2-3 layer flat-color background",
};

// Optional look modifier layered on top of the base style — additive,
// not a replacement, so the underlying construction rules (e.g. the
// stickman's circle head/dot eyes/stick limbs) still hold; this only
// changes rendering treatment (palette, texture, linework weight).
const STYLE_VARIANT_SUFFIX: Record<Exclude<StyleVariant, "default">, string> = {
  ghibli: "soft painterly Ghibli-inspired color palette, warm gentle lighting, lightly textured backgrounds",
  watercolor: "soft watercolor painting texture, gentle bleeding edges, muted natural palette",
  crayon: "waxy crayon texture, visible hand-drawn strokes, warm childlike coloring-book energy",
  sketchy: "loose sketchy linework, visible rough pencil/pen strokes, imperfect hand-drawn line quality",
  vivid: "highly saturated vivid colors, bold high-contrast palette, punchy graphic energy",
  cinematic: "cinematic lighting, dramatic shadow and highlight contrast, moody atmospheric depth",
};

/**
 * Derives one deterministic seed from the video's title so every scene's
 * illustration is generated with the same Pollinations seed. This is not
 * true character consistency (Pollinations has no reference-image
 * pinning) — it biases the model toward a similar overall palette and
 * rendering style across a video's scenes rather than a different random
 * look every time, which is the closest a free, keyless image API gets
 * to "the same character/world every scene."
 */
export function deriveStyleSeed(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return hash % 1_000_000;
}

/**
 * AI-illustrated visuals for the "whiteboard-doodle" and "cartoon"
 * styles — the actual "artbase.ai vibe" ask. Pollinations.ai (already
 * used elsewhere in this app for the background) is genuinely free, no
 * key, no card — no paid image-generation service was introduced for
 * this.
 *
 * Generates CLIPS_PER_SCENE illustrations per scene (not just one) so
 * illustrated scenes cut between shots the same way stock-media scenes
 * already do, rather than holding one flat picture for the whole scene.
 * Each shot gets its own seed (base seed + offset) and a small prompt
 * variation so they read as different angles on the same idea instead
 * of literal duplicates, while staying in the same overall style family.
 *
 * Each shot gets one retry on failure — Pollinations occasionally
 * returns a 500, and without a retry that whole shot silently becomes a
 * blank placeholder frame, which is part of what made an early test run
 * look "weird."
 *
 * Ken Burns/pan-zoom motion is still NOT applied here — that's being
 * built as its own separate, isolated, tested change (same discipline
 * as captions) rather than bundled in here, since zoompan is what
 * caused the earlier OOM crash and deserves its own verification pass
 * now that there's more headroom (2GB RAM) to test it against.
 */
async function generateIllustratedVisualsForScene(
  scene: Scene,
  outDir: string,
  style: Exclude<VideoStyle, "realistic">,
  onLog?: (text: string, service: "pollinations") => void,
  styleSeed?: number,
  styleVariant?: StyleVariant
): Promise<VisualAsset[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const baseSeed = styleSeed ?? deriveStyleSeed(scene.visualPrompt);
  // Unlike Pixabay's keyword search (which wants a short, punchy query —
  // see searchQuery()), Pollinations is generative and benefits from the
  // FULL descriptive prompt Groq wrote for the scene. Using the
  // truncated search-style query here was cutting real detail out of
  // every illustration.
  const variantSuffix =
    styleVariant && styleVariant !== "default" ? `, ${STYLE_VARIANT_SUFFIX[styleVariant]}` : "";
  const basePrompt = `${scene.visualPrompt}, ${STYLE_PROMPT_SUFFIX[style]}${variantSuffix}`;
  const shotVariants = ["", ", wide establishing shot", ", close-up detail"];

  const assets: VisualAsset[] = [];

  for (let i = 0; i < Math.min(CLIPS_PER_SCENE, shotVariants.length); i++) {
    const seed = baseSeed + i;
    const prompt = `${basePrompt}${shotVariants[i]}`;
    const outPath = path.join(outDir, `scene-${scene.index}-illustrated-${i}.jpg`);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=1920&height=1080&seed=${seed}&nologo=true`;

    let succeeded = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onLog?.(
          `Pollinations: generating ${style} illustration for scene ${scene.index + 1}` +
            ` (shot ${i + 1}/${Math.min(CLIPS_PER_SCENE, shotVariants.length)}${attempt > 1 ? ", retrying" : ""})`,
          "pollinations"
        );
        await downloadToFile(url, outPath);
        assets.push({ path: outPath, type: "image" });
        succeeded = true;
        break;
      } catch (err) {
        console.error(`Pollinations illustration failed (scene ${scene.index}, shot ${i}, attempt ${attempt}):`, err);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!succeeded) {
      onLog?.(`Pollinations: shot ${i + 1} failed twice for scene ${scene.index + 1}, skipping it`, "pollinations");
    }
  }

  if (assets.length === 0) {
    onLog?.(`Pollinations: every illustration failed for scene ${scene.index + 1}, using placeholder`, "pollinations");
    return [generatePlaceholderFrame(scene, outDir)];
  }

  onLog?.(`Pollinations: ${assets.length} illustration(s) ready for scene ${scene.index + 1}`, "pollinations");
  return assets;
}

/** Searches Pixabay's video library and downloads up to `count` matching clips. */
async function searchPixabayVideos(
  query: string,
  apiKey: string,
  count: number
): Promise<{ videos: Record<string, { url: string; width: number; height: number }> }[]> {
  const url =
    `https://pixabay.com/api/videos/?key=${apiKey}` +
    `&q=${encodeURIComponent(query)}&per_page=${Math.max(count, 3)}&safesearch=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay video search failed: ${res.status}`);
  const data = await res.json();
  return (data.hits ?? []) as { videos: Record<string, { url: string; width: number; height: number }> }[];
}

async function fetchPixabayVideos(
  scene: Scene,
  outDir: string,
  apiKey: string,
  count: number
): Promise<VisualAsset[]> {
  const primaryQuery = searchQuery(scene);
  let hits = await searchPixabayVideos(primaryQuery, apiKey, count);

  // Broader retry: Pixabay's search is literal keyword matching, so a
  // specific multi-word query can come back empty even when a simpler
  // version of the same idea has plenty of footage. Try just the first
  // one or two words before giving up on video entirely and dropping to
  // photos — a real (if less specific) video clip beats a static photo.
  if (hits.length === 0) {
    const broaderQuery = primaryQuery.split(" ").slice(0, 2).join(" ");
    if (broaderQuery && broaderQuery !== primaryQuery) {
      hits = await searchPixabayVideos(broaderQuery, apiKey, count);
    }
  }

  if (hits.length === 0) return [];

  fs.mkdirSync(outDir, { recursive: true });
  const assets: VisualAsset[] = [];

  for (let i = 0; i < Math.min(count, hits.length); i++) {
    // The instance now has real RAM headroom (2GB, up from the original
    // 512MB free tier), so prefer "large" (often 1080p) for a visibly
    // sharper result — falling back to medium/small only if a hit
    // doesn't have a large variant available.
    const variant = hits[i].videos.large || hits[i].videos.medium || hits[i].videos.small;
    if (!variant) continue;

    const outPath = path.join(outDir, `scene-${scene.index}-${i}.mp4`);
    try {
      await downloadToFile(variant.url, outPath);
    } catch {
      continue;
    }
    assets.push({ path: outPath, type: "video" });
  }

  return assets;
}

/** Falls back to still photos from Pixabay's photo library. */
async function fetchPixabayPhotos(
  scene: Scene,
  outDir: string,
  apiKey: string,
  count: number
): Promise<VisualAsset[]> {
  const query = searchQuery(scene);
  const url =
    `https://pixabay.com/api/?key=${apiKey}` +
    `&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=${Math.max(count, 3)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay photo search failed: ${res.status}`);

  const data = await res.json();
  const hits = (data.hits ?? []) as { largeImageURL?: string; webformatURL: string }[];
  if (hits.length === 0) return [];

  fs.mkdirSync(outDir, { recursive: true });
  const assets: VisualAsset[] = [];

  for (let i = 0; i < Math.min(count, hits.length); i++) {
    const imageUrl = hits[i].largeImageURL || hits[i].webformatURL;
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    try {
      await downloadToFile(imageUrl, outPath);
    } catch {
      continue;
    }
    assets.push({ path: outPath, type: "image" });
  }

  return assets;
}

/** Last-resort photo fallback if Pixabay has no key set or no matches at all. */
async function fetchPexelsPhotos(
  scene: Scene,
  outDir: string,
  apiKey: string,
  count: number
): Promise<VisualAsset[]> {
  const query = searchQuery(scene);

  const searchRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );
  if (!searchRes.ok) throw new Error(`Pexels photo search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const photos = (searchData.photos ?? []) as { src: Record<string, string> }[];
  if (photos.length === 0) return [];

  fs.mkdirSync(outDir, { recursive: true });
  const assets: VisualAsset[] = [];

  for (let i = 0; i < photos.length; i++) {
    const imageUrl: string = photos[i].src.large || photos[i].src.medium || photos[i].src.original;
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    try {
      await downloadToFile(imageUrl, outPath);
    } catch {
      continue;
    }
    assets.push({ path: outPath, type: "image" });
  }

  return assets;
}

const PLACEHOLDER_FONT_PATH = path.join(process.cwd(), "assets", "caption-font.ttf");

function wrapPlaceholderText(text: string, maxCharsPerLine = 36): string {
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
  return lines.slice(0, 6).join("\n");
}

/**
 * Renders a plain white frame with the scene's visual prompt as text —
 * the last-resort fallback when every real image/video source failed.
 *
 * This used to write an .svg file, which reads as an image to a human
 * but is NOT something the bundled ffmpeg binary can decode as a video
 * input (it has no SVG decoder compiled in) — composeVideo would crash
 * with "Decoder (codec svg) not found" the moment a placeholder was
 * actually needed. Rendering it as a real PNG via ffmpeg itself (same
 * drawtext+textfile pattern already proven for captions) guarantees
 * whatever comes out is something ffmpeg can always read back in.
 */
function generatePlaceholderFrame(scene: Scene, outDir: string): VisualAsset {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}-0.png`);
  const textPath = path.join(outDir, `scene-${scene.index}-placeholder-text.txt`);
  fs.writeFileSync(textPath, wrapPlaceholderText(scene.visualPrompt), "utf-8");

  const drawtext =
    `drawtext=fontfile='${PLACEHOLDER_FONT_PATH}':textfile='${textPath}':` +
    `fontsize=48:fontcolor=#111111:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=10`;

  try {
    execFileSync(
      ffmpegPath.path,
      ["-y", "-f", "lavfi", "-i", "color=c=white:s=1920x1080", "-vf", drawtext, "-frames:v", "1", outPath],
      { timeout: 20_000 }
    );
  } catch (err) {
    // If drawtext itself somehow fails, fall back to a blank white
    // frame with no text rather than crash the whole video.
    console.error("Placeholder drawtext render failed, using blank frame:", err);
    execFileSync(
      ffmpegPath.path,
      ["-y", "-f", "lavfi", "-i", "color=c=white:s=1920x1080", "-frames:v", "1", outPath],
      { timeout: 20_000 }
    );
  }

  return { path: outPath, type: "image" };
}
