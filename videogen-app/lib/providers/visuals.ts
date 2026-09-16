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
      const videoPath = await tryMatchedVideo(scene, outDir, pexelsKey);
      if (videoPath) return videoPath;
    } catch (err) {
      console.error(`Pexels video failed for scene ${scene.index}, trying photo:`, err);
    }

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

async function tryMatchedVideo(
  scene: Scene,
  outDir: string,
  apiKey: string
): Promise<string | null> {
  const query = searchQuery(scene);

  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );

  if (!res.ok) throw new Error(`Pexels video search failed: ${res.status}`);

  const data = await res.json();
  const video = data.videos?.[0];
  if (!video) return null;

  const files = (video.video_files ?? []) as { link: string; width: number; quality: string }[];
  const hd = files.find((f) => f.quality === "hd") ?? files[0];
  if (!hd) return null;

  const videoRes = await fetch(hd.link);
  const buffer = Buffer.from(await videoRes.arrayBuffer());

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}.mp4`);
  fs.writeFileSync(outPath, buffer);
  return outPath;
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

  const imageUrl: string = photo.src.large2x || photo.src.large || photo.src.original;
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
    PLACEHOLDER_TEXT
  </text>
  <text x="960" y="980" font-family="sans-serif" font-size="24" fill="#888888"
        text-anchor="middle">
    Scene placeholder — set PEXELS_API_KEY for real matching visuals
  </text>
</svg>`.trim();
  fs.writeFileSync(outPath, svg);
  return outPath;
}
