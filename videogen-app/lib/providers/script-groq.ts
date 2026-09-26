import { GenerateRequest, Script, Scene } from "../types";
import { getTrendContext } from "./trends";

// ─── Stickman Explainer Engine v1.0 ──────────────────────────────────────────
//
// Timing model : 3–4 seconds per clip  →  3.5s average
// Word model   : EXACTLY 6–7 words per scene narration line
// Scene count  : targetLengthSeconds / 3.5  (min 4)
//
// Structure
//   Scene 1  — HOOK     : counterintuitive claim / question that stops the scroll
//   Middle   — MECHANISM: one self-contained idea per scene, building in sequence
//   Last     — PAYOFF   : resonant gut-punch closing beat (never a summary)
//
// Visual prompts : ONE continuous prose paragraph — no line breaks, no headers,
// no bullet points, no field-style labels.  Always include a stickman action
// keyword so the programmatic renderer picks the correct pose.
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_RULES = `You are the Stickman Explainer Engine v1.0. Write short-form stickman video scripts that follow every one of these rules without exception:

1. HOOK FIRST — Scene 1 opens with the most counterintuitive or surprising fact about the topic. No "in this video", no title restatement, no warm-up. Drop straight into the claim or question that makes a viewer stop scrolling.

2. EXACT WORD COUNT — Each scene's "text" narration must be EXACTLY 6 to 7 words. Count every word before outputting. Rewrite any line that is off by even one word. Never output a line whose count is outside 6–7. This is the single most critical rule — a line longer than 7 words gets cut off before it finishes.

3. MECHANISM MIDDLE — Each middle scene explains one self-contained idea. Build from the hook toward the payoff in clear sequence. Short. Plain. One beat per scene.

4. PAYOFF LAST — The final scene lands a resonant closing fact or gut-punch line. Not a summary. Not "so what did we learn today." Just the moment that sticks.

5. PLAIN ENGLISH — Conversational, like a clever friend explaining something. No jargon. No academic language. No statistics unless they are striking and specific.

6. VISUAL PROMPTS AS PROSE — Each "visualPrompt" must be ONE single flowing paragraph of natural-language English with absolutely no line breaks, no headers, no bullet points, and no field-style labels like "CAMERA:" or "AUDIO:". Weave the background, the stickman action, and the mood together into one continuous descriptive sentence. Always include at least one stickman pose keyword so the renderer picks the right animation: celebrate, explain, question, walk, point, teach, slump, idle, argue, think.`;

const STICKMAN_VISUAL_GUIDE = `
Visual prompt guide for the stickman renderer — write every visualPrompt as one continuous prose paragraph:
- Describe the stickman's ACTION and POSE using at least one of these keywords: celebrate, explain, question, walk, point, teach, slump, idle, argue, think
- Describe the BACKGROUND as 2–3 flat solid colors with simple geometric shapes
- State the EMOTIONAL MOOD of the scene
- ONE paragraph, no line breaks, no labels
Good: "A stickman stands center frame excitedly pointing upward while explaining something, set against a bold blue background with simple white geometric shapes, the overall mood is energetic and optimistic."
Bad: "CAMERA: wide shot. CHARACTER: stickman pointing. BACKGROUND: blue." — never do this.`;

/**
 * Stickman Explainer Engine v1.0 — Groq-backed script generation.
 *
 * Engine rules (hardwired):
 *  - Clip length : 3.5 s average (3–4 s per clip)
 *  - Words/scene : EXACTLY 6–7 words per narration line
 *  - Scene count : targetLengthSeconds / 3.5  (min 4; comparison/drama always 5)
 *  - Structure   : Hook → Mechanism(s) → Payoff
 *  - Visual prompts: ONE continuous prose paragraph, no headers or bullets
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

  // ── Engine timing math ────────────────────────────────────────────────────
  // 3–4 s per clip → 3.5 s average per engine spec
  const CLIP_SECONDS = 3.5;

  const isComparison = req.scriptMode === "comparison" && !!req.conceptA && !!req.conceptB;
  const isDrama      = req.scriptMode === "drama"      && !!req.storyPremise;

  // Comparison and drama are always exactly 5 scenes (locked structure).
  // All other topics: divide total length by clip duration, min 4 scenes.
  const sceneCount =
    isComparison || isDrama
      ? 5
      : Math.max(4, Math.round(req.targetLengthSeconds / CLIP_SECONDS));

  onLog?.(
    `Groq: drafting ${sceneCount}-scene script (6–7 words per scene · ${Math.round(sceneCount * CLIP_SECONDS)}s total)`,
    "groq"
  );

  // ── Optional blocks ───────────────────────────────────────────────────────

  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search interest around this topic — weave in whichever fit naturally:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  const hybridBlock =
    req.scriptMode === "hybrid" && req.customScript?.trim()
      ? `\n\nThe user wrote a rough draft below. Use it as structural inspiration — keep their core topic and ideas but rewrite every line to hit the exact 6–7 word count per engine rules. Their draft:\n"""\n${req.customScript.trim()}\n"""`
      : "";

  const remixBlock =
    req.scriptMode === "remix" && req.remixTranscript?.trim()
      ? `\n\nTranscript to remix — study its STRUCTURE only (hook style, beat order, payoff type). Write a completely original script on the same topic. Never copy or paraphrase any sentence. Transcript:\n"""\n${req.remixTranscript.trim().slice(0, 4000)}\n"""`
      : "";

  const comparisonBlock = isComparison
    ? `\n\nThis is a "What's the Difference?" Short. Write EXACTLY 5 scenes — do not add or remove any:

SCENE 1 — HOOK: A vivid real-world scenario where confusing ${req.conceptA} and ${req.conceptB} causes a real problem. Drop in mid-action. End with a punchy question. EXACTLY 6–7 words.
SCENE 2 — DEFINE ${req.conceptA!.toUpperCase()}: One concrete, specific real-world example. EXACTLY 6–7 words.
SCENE 3 — DEFINE ${req.conceptB!.toUpperCase()}: Contrasting real-world example. EXACTLY 6–7 words.
SCENE 4 — THE KEY DIFFERENCE: One sharp line capturing the core split. EXACTLY 6–7 words.
SCENE 5 — CLOSER: A memorable trick to tell them apart forever. EXACTLY 6–7 words.

Scenes 2–4 visualPrompts should describe two stickman figures representing each concept side by side.`
    : "";

  const genreLabel = req.genre ?? "drama";
  const charALabel  = req.characterA?.trim() || "Character A";
  const charBLabel  = req.characterB?.trim() || "Character B";
  const dramaBlock = isDrama
    ? `\n\nThis is a SHORT DRAMA — a ${genreLabel} story in exactly 5 scenes. Every scene "text" must be EXACTLY 6–7 words.

SCENE 1 — SETUP: Establish the world and characters mid-moment.
SCENE 2 — INCITING INCIDENT: Something shatters the status quo.
SCENE 3 — RISING TENSION: Stakes escalate between ${charALabel} and ${charBLabel}.
SCENE 4 — CONFRONTATION / TWIST: The moment of revelation or clash.
SCENE 5 — CLIFFHANGER OR RESOLUTION: The gut-punch final beat.

Premise: ${req.storyPremise}. Characters: ${charALabel} and ${charBLabel}.`
    : "";

  const regenerateBlock =
    attempt > 0
      ? `\n\nThis is a regeneration — write a genuinely different hook, different specific examples, and a different structural approach. Do not reuse any phrasing or examples from a typical first-pass answer.`
      : "";

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `You write scripts for stickman short-form videos.
${ENGINE_RULES}
${STICKMAN_VISUAL_GUIDE}

Output ONLY valid JSON matching this shape — no other text:
{"title": string, "scenes": [{"text": string, "visualPrompt": string}]}

Write EXACTLY ${sceneCount} scenes. Each scene "text" must be EXACTLY 6 to 7 words — count word by word before outputting, and rewrite any line that misses the count.${trendBlock}${hybridBlock}${remixBlock}${comparisonBlock}${dramaBlock}${regenerateBlock}`;

  // ── API call ──────────────────────────────────────────────────────────────
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      // Higher temp on regenerations so the model doesn't return the same script
      temperature: attempt > 0 ? 1.1 : 0.9,
      // 4096 gives plenty of headroom for all scenes + visualPrompts
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: isComparison
            ? `What's the difference between ${req.conceptA} and ${req.conceptB}?`
            : isDrama
            ? `Write a ${genreLabel} short drama. Premise: ${req.storyPremise}. Characters: ${charALabel} and ${charBLabel}.`
            : `Topic: ${req.topic}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq script generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  const parsed: { title: string; scenes: { text: string; visualPrompt: string }[] } =
    JSON.parse(raw);

  onLog?.(`Groq: script drafted — "${parsed.title}" (${parsed.scenes.length} scenes)`, "groq");

  // Each scene is exactly CLIP_SECONDS long per engine spec
  const scenes: Scene[] = parsed.scenes.map((s, i) => ({
    index: i,
    text: s.text,
    visualPrompt: s.visualPrompt,
    startSeconds:    Math.round(i * CLIP_SECONDS),
    durationSeconds: Math.round(CLIP_SECONDS),
  }));

  return {
    title: parsed.title,
    scenes,
    fullNarrationText: scenes.map((s) => s.text).join(" "),
  };
}
