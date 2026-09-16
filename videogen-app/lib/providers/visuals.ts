import fs from "fs";
import path from "path";
import { Scene } from "../types";

/**
 * Generates the visual asset for one scene, trying free options in order
 * of "most like real video" to least:
 *   1. A real Pexels stock VIDEO clip matching the scene (actual motion)
 *   2. A Pexels stock PHOTO matching the scene (compose.ts adds Ken Burns
 *      pan/zoom to this so it still feels like video, not a still)
 *   3. A plain placeholder frame (if no PEXELS_API_KEY is set at all)
 *
 * Every step here is free — same Pexels key covers both photos and videos.
 */
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
  return
