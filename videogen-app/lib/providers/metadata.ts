import fs from "fs";
import path from "path";
import { Script } from "../types";
import { downloadToFile } from "./download";

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  thumbnailPrompt: string;
}

/**
 * Generates a title, description, tags, and a thumbnail prompt for a
 * finished script — the publish-ready metadata package, not just the
 * video itself. Same Groq key already used for scripts.
 */
export async function generateVideoMetadata(
  script: Script,
  apiKey: string,
  onLog?: (text: string, service: "groq") => void
): Promise<VideoMetadata> {
  onLog?.("Groq: writing title, description, tags, and thumbnail concept", "groq");

  const systemPrompt = `You write high-CTR YouTube metadata for short-form explainer/story videos. Given a video's script, produce:
- "title": under 60 characters where possible, high curiosity-gap, following formulas like "What Did [Group] Do [X]?", "How Did [Group] Survive [X]?", "Why Did/Don't [Group/We] [X]?", or a second-person mirror hook ("...And Why You [Still] [X] Too"). Never give away the answer in the title. If it could apply to five different videos, it's too generic.
- "description": fully SEO-optimized with natural keyword placement, but must read like real, compelling human-written copy on its own — never robotic or keyword-stuffed.
- "tags": an array of relevant tags. The combined character count of all tags joined by commas must not exceed 500 characters.
- "thumbnailPrompt": one complete, self-contained image-generation prompt for a high-CTR thumbnail — flat, high-contrast 2-3 tone background, no clutter; a central subject with an exaggerated emotional reaction (shock, awe, wide-eyed) or a stark side-by-side comparison; large bold 1-3 word headline text in the image itself (yellow or white fill, thick black outline) phrased as or implying a question that does NOT give away the answer; subject large enough to read at a glance. Describe the subject and scene fully — this prompt will be used in isolation with no other context.
Output ONLY valid JSON: {"title": string, "description": string, "tags": string[], "thumbnailPrompt": string}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Title working name: ${script.title}\n\nFull script:\n${script.fullNarrationText}` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq metadata generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed: VideoMetadata = JSON.parse(text);

  // Hard-enforce the 500-char tag budget rather than trust the model —
  // trim from the end until it fits.
  while (parsed.tags.join(", ").length > 500 && parsed.tags.length > 1) {
    parsed.tags.pop();
  }

  onLog?.(`Groq: metadata ready — "${parsed.title}"`, "groq");
  return parsed;
}

/**
 * Renders the thumbnail via Pollinations (same free, keyless image
 * service used for illustrated styles) at standard YouTube thumbnail
 * dimensions.
 */
export async function generateThumbnail(
  thumbnailPrompt: string,
  outDir: string,
  onLog?: (text: string, service: "pollinations") => void
): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const seed = Math.floor(Math.random() * 1_000_000);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(thumbnailPrompt)}` +
    `?width=1280&height=720&seed=${seed}&nologo=true`;

  onLog?.("Pollinations: generating thumbnail", "pollinations");
  const outPath = path.join(outDir, "thumbnail.jpg");
  await downloadToFile(url, outPath);
  onLog?.("Pollinations: thumbnail ready", "pollinations");
  return outPath;
}
