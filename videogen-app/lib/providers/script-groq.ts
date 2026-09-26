import { GenerateRequest, Script, Scene } from "../types";
import { getTrendContext } from "./trends";

// ─── Stickman Explainer Engine v1.0 ──────────────────────────────────────────
//
// One mode. One format. Professional production-ready stickman explainer scripts.
//
// Scene timing : 8 seconds per scene average
// Word count   : ~20-25 words per scene  (Piper TTS ~3 wps, deliberate pace)
// Scene count  : targetLengthSeconds / 8  (min 4)
//
// Structure (locked):
//   Scene 1  — HOOK     : counterintuitive claim/question that stops the scroll
//   Middle   — MECHANISM: one clear self-contained idea per scene, building in sequence
//   Last     — PAYOFF   : resonant gut-punch closing beat — never a summary
//
// Visual prompts: ONE continuous prose paragraph per scene — no headers,
// no bullets, no labels. Always includes a stickman action keyword.
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_PROMPT = `You are the Stickman Explainer Engine. Write professional, production-ready short-form stickman explainer video scripts. Follow every rule below without exception.

STRUCTURE — locked for every video:
- Scene 1 is the HOOK: drop straight into the most counterintuitive or surprising fact about the topic. No "in this video", no "today we explore", no warm-up. Make the viewer need to keep watching.
- Middle scenes are the MECHANISM: each scene covers exactly one clear idea, building toward the payoff in logical sequence. Short plain sentences. One beat per scene.
- Final scene is the PAYOFF: one resonant, memorable closing line that reframes everything. Not a summary. Not "so what did we learn." Just the moment that sticks.

WRITING RULES:
- Plain conversational English — like a clever friend explaining something over coffee
- Specific facts with names, numbers, dates or places — never vague generalities
- No jargon, no academic language, no filler phrases ("it is worth noting that", "interestingly", "the fact that")
- Every sentence earns its place or gets cut
- Mix sentence lengths: a longer sentence to build, then a short punch. Vary the rhythm.
- No sponsor copy, no subscribe prompts, no sign-offs

VISUAL PROMPT RULES — critical:
Each "visualPrompt" must be ONE single flowing paragraph of natural-language English prose. No line breaks. No headers. No bullet points. No labels like "CAMERA:" or "BACKGROUND:". Weave the stickman's action, the background, and the mood into one continuous descriptive sentence. Always include at least one of these stickman pose keywords so the renderer picks the right animation: celebrate, explain, question, walk, point, teach, slump, idle, argue, think.

Good visual prompt: "A stickman stands center frame explaining something with one arm raised and pointing upward, set against a bold warm orange background with simple geometric shapes suggesting an office or classroom, the mood is focused and energetic."
Bad visual prompt (never do this): "CAMERA: medium shot. CHARACTER: stickman pointing. BACKGROUND: orange."`;

/**
 * Generates a professional stickman explainer script via Groq.
 *
 * Single mode — no comparison, drama, hybrid, or remix complexity.
 * Engine rules are hardwired: Hook → Mechanism → Payoff, prose visual prompts.
 */
export async function generateScriptGroq(
  req: GenerateRequest,
  onLog?: (text: string, service: "groq" | "tavily") => void,
  attempt = 0
): Promise<Script> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Get a free key at console.groq.com/keys");
  }

  if (process.env.TAVILY_API_KEY) {
    onLog?.(`Tavily: pulling current search trends for "${req.topic}"`, "tavily");
  }
  const trendTerms = await getTrendContext(req.topic);
  if (trendTerms.length > 0) {
    onLog?.(`Tavily: found ${trendTerms.length} trend term(s) to weave into the script`, "tavily");
  }

  // ── Scene & word count math ───────────────────────────────────────────────
  // 8 seconds per scene average, Piper TTS at ~3 words/second deliberate pace
  const SCENE_SECONDS = 8;
  const WORDS_PER_SCENE = 22; // ~3 wps × 8s = comfortable, punchy delivery

  const sceneCount = Math.max(4, Math.round(req.targetLengthSeconds / SCENE_SECONDS));
  const targetWordCount = sceneCount * WORDS_PER_SCENE;

  onLog?.(
    `Groq: drafting ${sceneCount}-scene script (~${targetWordCount} words total)`,
    "groq"
  );

  // ── Trend context ─────────────────────────────────────────────────────────
  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search interest around this topic — weave in whichever fit naturally:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  // ── Regeneration nudge ────────────────────────────────────────────────────
  const regenerateBlock =
    attempt > 0
      ? `\n\nThis is a regeneration. Write a genuinely different hook, different specific facts or examples, and a different structural approach. Do not reuse any phrasing from a typical first-pass answer.`
      : "";

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `${ENGINE_PROMPT}

Output ONLY valid JSON matching this exact shape — no markdown, no extra text:
{"title": string, "scenes": [{"text": string, "visualPrompt": string}]}

Write EXACTLY ${sceneCount} scenes. Each scene "text" should be approximately ${WORDS_PER_SCENE} words — professional, punchy, production-ready narration.${trendBlock}${regenerateBlock}`;

  // ── Groq API call ─────────────────────────────────────────────────────────
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: attempt > 0 ? 1.1 : 0.9,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: `Topic: ${req.topic}` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq script generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content ?? "";
  const parsed: { title: string; scenes: { text: string; visualPrompt: string }[] } =
    JSON.parse(raw);

  onLog?.(`Groq: script drafted — "${parsed.title}" (${parsed.scenes.length} scenes)`, "groq");

  const perSceneSeconds = req.targetLengthSeconds / parsed.scenes.length;
  const scenes: Scene[] = parsed.scenes.map((s, i) => ({
    index: i,
    text:            s.text,
    visualPrompt:    s.visualPrompt,
    startSeconds:    Math.round(i * perSceneSeconds),
    durationSeconds: Math.round(perSceneSeconds),
  }));

  return {
    title:              parsed.title,
    scenes,
    fullNarrationText:  scenes.map((s) => s.text).join(" "),
  };
}
