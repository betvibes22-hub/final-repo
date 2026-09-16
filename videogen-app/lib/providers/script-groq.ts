import { GenerateRequest, Script, Scene, ScriptVibe } from "../types";
import { getTrendContext } from "./trends";

const VIBE_INSTRUCTIONS: Record<ScriptVibe, string> = {
  documentary:
    "Write in a calm, informative documentary/explainer voice — measured pacing, factual, narrator-style.",
  "fun-shorts":
    "Write with fun, casual YouTube Shorts/TikTok energy — punchy short sentences, a strong hook in the first line, conversational slang where natural, playful asides. This should feel like a creator talking directly to camera, not a narrator reading facts.",
  storytime:
    "Write like a relatable \"storytime\" video — first-person or narrative voice, build suspense/curiosity, casual and personal in tone, like someone telling a friend what happened.",
  hype:
    "Write with high-energy hype — bold declarative hooks, rapid-fire pacing, exclamation-worthy beats, the kind of energy that makes someone stop scrolling in the first 2 seconds and stay for a big payoff.",
};

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

  const draftWordCount = req.customScript?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const hybridBlock =
    req.scriptMode === "hybrid" && req.customScript?.trim()
      ? `\n\nThe user wrote a rough draft below (${draftWordCount} words). It is a starting point ONLY — it is too short/thin on its own. Do NOT simply repeat, lightly rephrase, or return it unchanged. You MUST substantially rewrite and expand it to reach ~${targetWordCount} words: keep their core ideas, topic, and tone, but add narrative detail, concrete examples, transitions between beats, and depth on each point so it reads like a fully produced script, not a draft. If the draft doesn't specify a structure, write it as a well-paced explainer with a hook, build-up, and payoff. Their draft:\n"""\n${req.customScript.trim()}\n"""`
      : "";

  const vibe = req.vibe ?? "documentary";
  const vibeInstruction = VIBE_INSTRUCTIONS[vibe];

  const systemPrompt = `You write scripts for ${req.style} short-form videos.
${vibeInstruction}
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
