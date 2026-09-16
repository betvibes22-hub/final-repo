import fs from "fs";
import path from "path";
import { Scene, VideoStyle, VisualAsset } from "../types";

/**
 * Generates the visual asset(s) for one scene — real stock video by
 * default, so cuts between scenes show actual motion footage instead
 * of static images.
 *
 * Primary source: Pixabay's video API — genuinely free (just a signup
 * key, no card), CC-style commercial-use license, no attribution
 * required. One matched clip per scene is enough since the clip
 * already has its own motion (unlike the old static-photo approach,
 * which needed several photos per scene to feel edited).
 *
 * Falls back to a Pixabay photo (same free key, same account) if no
 * video result matches the scene, then to a Pexels photo, then to a
 * plain placeholder frame as a last resort — so a scene always gets
 * *something*, even if real footage wasn't available for that topic.
 */
export async function generateVisualsForScene(
  scene: Scene,
  outDir: string,
  style: VideoStyle = "realistic"
): Promise<VisualAsset[]> {
  const pixabayKey = process.env.PIXABAY_API_KEY;

  if (pixabayKey) {
    try {
      const asset = await fetchPixabayVideo(scene, outDir, pixabayKey);
      if (asset) return [asset];
    } catch (err) {
      console.error(`Pixabay video failed for scene ${scene.index}, trying Pixabay photo:`, err);
    }

    try {
      const asset = await fetchPixabayPhoto(scene, outDir, pixabayKey);
      if (asset) return [asset];
    } catch (err) {
      console.error(`Pixabay photo failed for scene ${scene.index}, trying Pexels:`, err);
    }
  }

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const asset = await fetchPexelsPhoto(scene, outDir, pexelsKey);
      if (asset) return [asset];
    } catch (err) {
      console.error(`Pexels photo failed for scene ${scene.index}, falling back to placeholder:`, err);
    }
  }

  return [generatePlaceholderFrame(scene, outDir)];
}

function searchQuery(scene: Scene): string {
  return scene.visualPrompt.split(",")[0].split(".")[0].trim().slice(0, 60);
}

/** Searches Pixabay's video library and downloads the best-matching clip. */
async function fetchPixabayVideo(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<VisualAsset | null> {
  const query = searchQuery(scene);
  const url =
    `https://pixabay.com/api/videos/?key=${apiKey}` +
    `&q=${encodeURIComponent(query)}&per_page=3&safesearch=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay video search failed: ${res.status}`);

  const data = await res.json();
  const hits = (data.hits ?? []) as {
    videos: Record<string, { url: string; width: number; height: number }>;
  }[];
  if (hits.length === 0) return null;

  // "medium" balances real quality against download size on a
  // resource-limited free host — "large" is often 1080p+ and risks
  // the same kind of memory pressure that caused the zoompan OOM crash.
  const variant = hits[0].videos.medium || hits[0].videos.small || hits[0].videos.large;
  if (!variant) return null;

  const videoRes = await fetch(variant.url);
  if (!videoRes.ok) throw new Error(`Pixabay video download failed: ${videoRes.status}`);

  fs.mkdirSync(outDir, { recursive: true });
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const outPath = path.join(outDir, `scene-${scene.index}-0.mp4`);
  fs.writeFileSync(outPath, buffer);

  return { path: outPath, type: "video" };
}

/** Falls back to a still photo from Pixabay's photo library. */
async function fetchPixabayPhoto(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<VisualAsset | null> {
  const query = searchQuery(scene);
  const url =
    `https://pixabay.com/api/?key=${apiKey}` +
    `&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=3`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay photo search failed: ${res.status}`);

  const data = await res.json();
  const hits = (data.hits ?? []) as { largeImageURL?: string; webformatURL: string }[];
  if (hits.length === 0) return null;

  const imageUrl = hits[0].largeImageURL || hits[0].webformatURL;
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Pixabay photo download failed: ${imageRes.status}`);

  fs.mkdirSync(outDir, { recursive: true });
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const outPath = path.join(outDir, `scene-${scene.index}-0.jpg`);
  fs.writeFileSync(outPath, buffer);

  return { path: outPath, type: "image" };
}

/** Last-resort photo fallback if Pixabay has no key set or no match at all. */
async function fetchPexelsPhoto(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<VisualAsset | null> {
  const query = searchQuery(scene);

  const searchRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );
  if (!searchRes.ok) throw new Error(`Pexels photo search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const photos = (searchData.photos ?? []) as { src: Record<string, string> }[];
  if (photos.length === 0) return null;

  const imageUrl: string = photos[0].src.large || photos[0].src.medium || photos[0].src.original;
  const imageRes = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}-0.jpg`);
  fs.writeFileSync(outPath, imageBuffer);

  return { path: outPath, type: "image" };
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
