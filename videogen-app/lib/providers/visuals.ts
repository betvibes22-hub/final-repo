import fs from "fs";
import path from "path";
import { Scene } from "../types";

/**
 * Generates the visual asset for one scene. This is the pluggable, most
 * expensive part of the pipeline — swap the provider via VISUAL_PROVIDER
 * in your .env.local.
 *
 * "static-doodle" is included as a FREE fallback: it renders a simple
 * whiteboard-style placeholder frame (title text on a plain background)
 * instead of calling a paid AI model. Good for testing the whole pipeline
 * end-to-end before you spend money on real generation.
 */
export async function generateVisualForScene(
  scene: Scene,
  outDir: string
): Promise<string> {
  const provider = process.env.VISUAL_PROVIDER ?? "static-doodle";

  switch (provider) {
    case "static-doodle":
      return generateStaticDoodleFrame(scene, outDir);
    case "kling":
      return generateWithKling(scene, outDir);
    case "wan":
      return generateWithWan(scene, outDir);
    default:
      throw new Error(
        `Unknown VISUAL_PROVIDER "${provider}". Use "static-doodle", "kling", or "wan", ` +
          `or add your own case in lib/providers/visuals.ts.`
      );
  }
}

/**
 * FREE placeholder: renders a plain PNG frame with the scene's visual prompt
 * as text, via an SVG-to-PNG conversion. This lets you test the full
 * pipeline (script → voiceover → visuals → compose) without spending money,
 * before wiring up a real paid model.
 */
async function generateStaticDoodleFrame(scene: Scene, outDir: string): Promise<string> {
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
    Scene ${scene.index + 1} — placeholder frame (set VISUAL_PROVIDER for real visuals)
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

/**
 * Example adapter for a Kling-style hosted API.
 * FILL IN: Kling's actual endpoint and response shape once you pick a
 * specific access route (their own API, or an aggregator like fal.ai).
 */
async function generateWithKling(scene: Scene, outDir: string): Promise<string> {
  const apiKey = process.env.VISUAL_PROVIDER_API_KEY;
  const apiUrl = process.env.VISUAL_PROVIDER_API_URL;
  if (!apiKey || !apiUrl) {
    throw new Error("VISUAL_PROVIDER_API_KEY / VISUAL_PROVIDER_API_URL not set for Kling.");
  }

  // TODO: replace with Kling's real request/response shape.
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: scene.visualPrompt,
      duration: scene.durationSeconds,
    }),
  });

  if (!response.ok) {
    throw new Error(`Kling generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const videoUrl: string = data.videoUrl; // adjust to Kling's actual field name

  const videoResponse = await fetch(videoUrl);
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scene-${scene.index}.mp4`);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

/**
 * Example adapter for a self-hosted or rented Wan 2.2 ComfyUI endpoint.
 * FILL IN: your ComfyUI workflow's actual API shape.
 */
async function generateWithWan(scene: Scene, outDir: string): Promise<string> {
  const apiUrl = process.env.VISUAL_PROVIDER_API_URL;
  if (!apiUrl) {
    throw new Error("VISUAL_PROVIDER_API_URL not set for Wan (your ComfyUI endpoint).");
  }
  // TODO: wire this up to your actual ComfyUI workflow JSON + polling.
  throw new Error("Wan adapter is a stub — fill in your ComfyUI workflow call here.");
}
