import fs from "fs";
import path from "path";
import { Scene } from "../types";

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

  const imageUrl: string = photo.src.large || photo.src.medium || photo.src.original;
  const imageRes = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  fs.mkdirSync(outDir, { recursive: true });
