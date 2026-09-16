import { GenerateRequest, Script, Scene } from "../types";
import { getTrendContext } from "./trends";

/**
 * Groq version of script generation — genuinely free, no credit card
 * required (console.groq.com). Uses an OpenAI-compatible endpoint.
 *
 * Supports hybrid mode: if req.customScript is set alongside
 * scriptMode "hybrid", the user's draft is handed to the model as
 * material to expand/polish into full scenes, rather than writing from
 * scratch.
 */
export async function generateScriptGroq(req: GenerateRequest): Promise<Script> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Get a free key at console.groq.com/keys");
  }

  const trendTerms = await getTrendContext(req.topic);
  const targetWordCount = Math.round(req.targetLengthSeconds * 2.5);
  const sceneCount = Math.max(3, Math.round(req.targetLengthSeconds / 15));

  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search interest around this topic — weave in whichever genuinely fit:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  const hybridBlock =
    req.scriptMode === "hybrid" && req.customScript?.trim()
      ? `\n\nThe user has already written a draft — expand and polish THIS into the full script rather than writing something new. Keep their ideas, wording, and voice; fill gaps and split it into scenes:\n"""\n${req.customScript.trim()}\n"""`
      : "";

  const systemPrompt = `You write scripts for ${req.style} explainer/story videos.
Output ONLY valid JSON matching this shape, no other text:
{"title": string, "scenes": [{"text": string, "visualPrompt": string}]}
Write exactly ${sceneCount} scenes, ~${targetWordCount} words total narration.${trendBlock}${hybridBlock}`;

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
        { role: "user", content: `Topic: ${req.topic}` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq script generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed: { title: string; scenes: { text: string; visualPrompt: string }[] } =
    JSON.parse(text);

  const perSceneSeconds = req.targetLengthSeconds / parsed.scenes.length;
  const scenes: Scene[] = parsed.scenes.map((s, i) => ({
    index: i,
    text: s.text,
    visualPrompt: s.visualPrompt,
    startSeconds: Math.round(i * perSceneSeconds),
    durationSeconds: Math.round(perSceneSeconds),
  }));

  return {
    title: parsed.title,
    scenes,
    fullNarrationText: scenes.map((s) => s.text).join(" "),
  };
}
