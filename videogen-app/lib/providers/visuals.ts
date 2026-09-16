import fs from "fs";
import path from "path";
import { Scene } from "../types";

const PHOTOS_PER_SCENE = 3;

/**
 * Generates the visual assets for one scene — now MULTIPLE photos per
 * scene (cut between them every few seconds) instead of one static photo
 * held for the whole duration. Gives real editing rhythm without the
 * memory cost of ffmpeg's zoompan effect, which crashed the free-tier
 * server earlier.
 *
 * Returns an array of image paths, in the order they should play.
 */
export async function generateVisualsForScene(
  scene: Scene,
  outDir: string
): Promise<string[]> {
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
  <text x="960" y="980" font-family="sans-serif" font-size="24" fill="#888888"
        text-anchor="middle">
    Scene placeholder — set PEXELS_API_KEY for real matching visuals
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
