import fs from "fs";
import path from "path";
import { Scene, VideoStyle } from "../types";

const PHOTOS_PER_SCENE = 3;

const STYLE_PROMPT_SUFFIX: Record<VideoStyle, string> = {
  "whiteboard-doodle": "simple whiteboard doodle sketch, black marker line art on white background, minimal, hand-drawn style",
  cartoon: "clean modern explainer-video illustration, flat 2D vector art, bold simple character shapes, thick smooth outlines, limited soft color palette, minimal shading, polished corporate animation style, simple gradient background, professional motion-graphics look",
  realistic: "photorealistic, natural lighting, high detail",
};

/**
 * Generates the visual assets for one scene — multiple images (cut
 * between them every few seconds) so it feels edited, not static.
 *
 * Primary source: Pollinations.ai — free, no key, no signup at all.
 * Generates an actual AI illustration matching the chosen style
 * (whiteboard doodle / cartoon / realistic), so the style picker
 * genuinely changes how the video looks instead of always showing
 * generic stock photos.
 *
 * Falls back to matched Pexels stock photos if Pollinations doesn't
 * return a usable image, then to a plain placeholder as a last resort.
 */
export async function generateVisualsForScene(
  scene: Scene,
  outDir: string,
  style: VideoStyle = "realistic"
): Promise<string[]> {
  try {
    const paths = await generatePollinationsImages(scene, outDir, style);
    if (paths.length > 0) return paths;
  } catch (err) {
    console.error(`Pollinations failed for scene ${scene.index}, trying Pexels:`, err);
  }

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      return await generateMatchedPhotos(scene, outDir, pexelsKey);
    } catch (err) {
      console.error(`Pexels photos failed for scene ${scene.index}, falling back:`, err);
    }
  }

  return [generatePlaceholderFrame(scene, outDir)];
}

function searchQuery(scene: Scene): string {
  return scene.visualPrompt.split(",")[0].split(".")[0].trim().slice(0, 60);
}

/** Generates PHOTOS_PER_SCENE style-matched AI images via Pollinations (free, no key). */
async function generatePollinationsImages(
  scene: Scene,
  outDir: string,
  style: VideoStyle
): Promise<string[]> {
  const basePrompt = `${scene.visualPrompt}, ${STYLE_PROMPT_SUFFIX[style]}`;
  fs.mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];

  for (let i = 0; i < PHOTOS_PER_SCENE; i++) {
    // Different seed per image so the 3 images in a scene actually vary
    // instead of all being identical.
    const seed = scene.index * 1000 + i;
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(basePrompt)}` +
      `?width=1920&height=1080&seed=${seed}&nologo=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pollinations request failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    fs.writeFileSync(outPath, buffer);
    paths.push(outPath);
  }

  return paths;
}

async function generateMatchedPhotos(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<string[]> {
  const query = searchQuery(scene);

  const searchRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${PHOTOS_PER_SCENE}&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );

  if (!searchRes.ok) throw new Error(`Pexels photo search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const photos = (searchData.photos ?? []) as { src: Record<string, string> }[];
  if (photos.length === 0) throw new Error(`No Pexels photo results for query "${query}"`);

  fs.mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const imageUrl: string = photo.src.large || photo.src.medium || photo.src.original;
    const imageRes = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const outPath = path.join(outDir, `scene-${scene.index}-${i}.jpg`);
    fs.writeFileSync(outPath, imageBuffer);
    paths.push(outPath);
  }

  return paths;
}

function generatePlaceholderFrame(scene: Scene, outDir: string): string {
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
  return outPath;
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
