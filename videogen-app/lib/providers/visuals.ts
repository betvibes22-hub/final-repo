import fs from "fs";
import path from "path";
import { Scene } from "../types";

/**
 * Generates the visual asset for one scene.
 *
 * Uses matched Pexels PHOTOS (not video clips) — compose.ts applies a
 * Ken Burns pan/zoom to these so they still feel like motion, not a dead
 * still. Video clips were tried initially but downloading full HD video
 * files for every scene pushed memory usage past Render's free-tier
 * 512MB limit and crashed the server mid-render. Photos are far lighter
 * and keep the whole pipeline reliable on the free tier.
 */
export async function generateVisualForScene(
  scene: Scene,
  outDir: string
): Promise<string> {
  const pexelsKey = process.env.PEXELS_API_KEY;

  if (pexelsKey) {
    try {
      return await generateMatchedPhotoFrame(scene, outDir, pexelsKey);
    } catch (err) {
      console.error(`Pexels photo failed for scene ${scene.index}, falling back:`, err);
    }
  }

  return generatePlaceholderFrame(scene, outDir);
}

function searchQuery(scene: Scene): string {
  return scene.visualPrompt.split(",")[0].split(".")[0].trim().slice(0, 60);
}

async function generateMatchedPhotoFrame(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<string> {
  const query = searchQuery(scene);

  const searchRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );

  if (!searchRes.ok) throw new Error(`Pexels photo search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const photo = searchData.photos?.[0];
  if (!photo) throw new Error(`No Pexels photo results for query "${query}"`);

  // "large" instead of "large2x" — smaller file, less memory, still plenty
  // sharp once scaled down to 1920x1080 in compose.ts.
  const imageUrl: string = photo.src.large || photo.src.medium || photo.src.original;
  const imageRes = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}.jpg`);
  fs.writeFileSync(outPath, imageBuffer);
  return outPath;
}

async function generatePlaceholderFrame(scene: Scene, outDir: string): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}.svg`);
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
