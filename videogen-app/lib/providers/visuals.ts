import fs from "fs";
import path from "path";
import { Scene, VideoStyle, VisualAsset } from "../types";

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
  style: VideoStyle = "realistic"
): Promise<VisualAsset[]> {
  const pixabayKey = process.env.PIXABAY_API_KEY;

  if (pixabayKey) {
    try {
      const assets = await fetchPixabayVideos(scene, outDir, pixabayKey, CLIPS_PER_SCENE);
      if (assets.length > 0) return assets;
    } catch (err) {
      console.error(`Pixabay video failed for scene ${scene.index}, trying Pixabay photos:`, err);
    }

    try {
      const assets = await fetchPixabayPhotos(scene, outDir, pixabayKey, CLIPS_PER_SCENE);
      if (assets.length > 0) return assets;
    } catch (err) {
      console.error(`Pixabay photos failed for scene ${scene.index}, trying Pexels:`, err);
    }
  }

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const assets = await fetchPexelsPhotos(scene, outDir, pexelsKey, CLIPS_PER_SCENE);
      if (assets.length > 0) return assets;
    } catch (err) {
      console.error(`Pexels photos failed for scene ${scene.index}, falling back to placeholder:`, err);
    }
  }

  return [generatePlaceholderFrame(scene, outDir)];
}

function searchQuery(scene: Scene): string {
  return scene.visualPrompt.split(",")[0].split(".")[0].trim().slice(0, 60);
}

/** Searches Pixabay's video library and downloads up to `count` matching clips. */
async function fetchPixabayVideos(
  scene: Scene,
  outDir: string,
  apiKey: string,
  count: number
): Promise<VisualAsset[]> {
  const query = searchQuery(scene);
  const url =
    `https://pixabay.com/api/videos/?key=${apiKey}` +
    `&q=${encodeURIComponent(query)}&per_page=${Math.max(count, 3)}&safesearch=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay video search failed: ${res.status}`);

  const data = await res.json();
  const hits = (data.hits ?? []) as {
    videos: Record<string, { url: string; width: number; height: number }>;
  }[];
  if (hits.length === 0) return [];

  fs.mkdirSync(outDir, { recursive: true });
  const assets: VisualAsset[] = [];

  for (let i = 0; i < Math.min(count, hits.length); i++) {
    // "medium" balances real quality against download size on a
    // resource-limited free host — "large" is often 1080p+ and risks
    // the same kind of memory pressure that caused the zoompan OOM crash.
    const variant = hits[i].videos.medium || hits[i].videos.small || hits[i].videos.large;
    if (!variant) continue;

    const videoRes = await fetch(variant.url);
    if (!videoRes.ok) continue;

    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.mp4`);
    fs.writeFileSync(outPath, buffer);
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
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) continue;

    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    fs.writeFileSync(outPath, buffer);
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
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) continue;

    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    fs.writeFileSync(outPath, buffer);
    assets.push({ path: outPath, type: "image" });
  }

  return assets;
}

function generatePlaceholderFrame(scene: Scene, outDir: string): VisualAsset {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}-0.svg`);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="#ffffff"/>
  <rect x="40" y="40" width="1840" height="1000" fill="none" stroke="#111111" stroke-width="4"/>
  <text x="960" y="500" font-family="Comic Sans MS, cursive" font-size="48"
        fill="#111111" text-anchor="middle">
    ${escapeXml(scene.visualPrompt).slice(0, 80)}
  </text>
</svg>`.trim();
  fs.writeFileSync(outPath, svg);
  return { path: outPath, type: "image" };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}
