import { GenerateRequest, Script, Scene } from "../types";
import { getTrendContext } from "./trends";

// Single, high-quality script instruction that works for all topics.
// Replaces the old VIBE_INSTRUCTIONS system which produced boring, generic output.
const SCRIPT_INSTRUCTION = `Write a gripping, high-retention short-form video script. Every script MUST follow these rules without exception:

1. COLD OPEN — No "in this video," no "today we're looking at," no title restating. Drop the viewer directly into a specific, sensory, high-stakes moment. Start mid-action. The first sentence should make someone stop scrolling.

2. SPECIFIC FACTS ONLY — Every claim needs a name, number, date, or place. Never write "a long time ago" — write the year. Never "scientists discovered" — name the scientist. Never "many people" — give a real figure. Vague claims are cut.

3. SENTENCE RHYTHM — Mix long sentences with sudden short punches. Fragment. Two words. Then a longer sentence to breathe and expand before the next short hit. Rhythm is what keeps people listening.

4. BUILD TENSION — Every scene should plant a question the viewer needs answered. Seed a specific detail early. Pay it off later. Make them need to reach the end.

5. NO FILLER — Cut every word that could be removed without losing information. "The fact that" → cut. "It is worth noting that" → cut. "Interestingly" → cut. Every single sentence earns its place or it goes.

6. PUNCHY CLOSER — End with one resonant line that zooms out — not a summary, not a "so what did we learn today," just a gut-punch final beat that sticks.`;

/**
 * Groq version of script generation — genuinely free, no credit card
 * required (console.groq.com). Uses an OpenAI-compatible endpoint.
 *
 * Supports hybrid mode: if req.customScript is set alongside
 * scriptMode "hybrid", the user's draft is handed to the model as
 * material to expand/polish into full scenes, rather than writing from
 * scratch.
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

  const isComparison = req.scriptMode === "comparison" && !!req.conceptA && !!req.conceptB;
  // Piper TTS speaks at ~4 words/second (faster than the old 2.5 estimate).
  // Under-estimating this is why 45-second videos were ending at ~28 seconds —
  // the TTS finished narrating 112 words in ~28s, then -shortest cut the video.
  // 4.0 wps means ~180 words for a 45s script → audio fills the full duration.
  const targetWordCount = Math.round(req.targetLengthSeconds * 4.0);
  // Comparison and drama formats are always exactly 5 scenes regardless of length
  const sceneCount =
    isComparison || req.scriptMode === "drama" ? 5 : Math.max(3, Math.round(req.targetLengthSeconds / 15));
  onLog?.(
    `Groq: drafting ${sceneCount}-scene script (~${targetWordCount} words)`,
    "groq"
  );

  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search interest around this topic — weave in whichever genuinely fit:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  const draftWordCount = req.customScript?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const hybridBlock =
    req.scriptMode === "hybrid" && req.customScript?.trim()
      ? `\n\nThe user wrote a rough draft below (${draftWordCount} words). It is a starting point ONLY — it is too short/thin on its own. Do NOT simply repeat, lightly rephrase, or return it unchanged. You MUST substantially rewrite and expand it to reach ~${targetWordCount} words: keep their core ideas, topic, and tone, but add narrative detail, concrete examples, transitions between beats, and depth on each point so it reads like a fully produced script, not a draft. If the draft doesn't specify a structure, write it as a well-paced explainer with a hook, build-up, and payoff. Their draft:\n"""\n${req.customScript.trim()}\n"""`
      : "";

  // Remix mode: the user uploaded a video and wants "one like that,"
  // remade. This is deliberately built as structural inspiration only —
  // topic, pacing, beat order, how it hooks and pays off — never as
  // wording to copy. The instruction below is explicit and repeated for
  // a reason: reusing someone else's actual sentences would just be
  // uncredited copying with extra steps, not a genuinely new video.
  const remixBlock =
    req.scriptMode === "remix" && req.remixTranscript?.trim()
      ? `\n\nBelow is a transcript of a video the user wants to remake in their own style. Study its TOPIC, STRUCTURE, and PACING only — the order of ideas, how it opens, how it builds, how it lands. Do NOT copy, closely paraphrase, or lift any sentence or distinctive phrase from it. Write a completely ORIGINAL script, in your own words throughout, that covers similar ground with a similar shape but is not a reproduction of this one in any way. Treat the transcript as a structural reference, never as source text to quote from. Transcript:\n"""\n${req.remixTranscript.trim().slice(0, 6000)}\n"""`
      : "";

  // "What's the Difference?" comparison format — locked 5-scene structure:
  // Scene 1: Hook — open with a sharp, specific scenario where the difference matters
  // Scene 2: Define A — concrete real-world example of concept A
  // Scene 3: Define B — contrasting real-world example of concept B
  // Scene 4: The Key Difference — one sharp, memorable line + same-scenario example showing the split
  // Scene 5: Closer — a quick memorable trick or test to tell them apart forever
  const comparisonBlock =
    req.scriptMode === "comparison" && req.conceptA && req.conceptB
      ? `\n\nThis is a "What's the Difference?" Short. Write EXACTLY 5 scenes following this locked structure — do NOT add or remove scenes, do NOT reorder them:

SCENE 1 — HOOK: Open mid-action with a vivid, specific real-world scenario where confusing ${req.conceptA} and ${req.conceptB} causes a real problem. No "today we compare" — drop straight into the moment. Make it embarrassing, costly, or funny. One punchy question to close the scene.

SCENE 2 — DEFINE ${req.conceptA.toUpperCase()}: What IS ${req.conceptA}? Give one concrete, specific, real-world example with a name, number, or place. Show it in action. Short sentences. No fluff.

SCENE 3 — DEFINE ${req.conceptB.toUpperCase()}: What IS ${req.conceptB}? Same treatment — one vivid example that clearly contrasts with Scene 2. Parallel structure helps viewers compare.

SCENE 4 — THE KEY DIFFERENCE: One sharp, memorable sentence that captures the core split. Then put BOTH concepts into the exact same scenario side by side — show what happens with ${req.conceptA} versus what happens with ${req.conceptB}. Make the gap obvious and memorable.

SCENE 5 — THE CLOSER: End with a single memorable trick, rule of thumb, or mental test the viewer can use FOREVER to tell them apart. Punchy. Confident. Done.

The visual prompts for scenes 2–4 should show two stickman figures or two side-by-side situations — the "A vs B" contrast must be visible in the image, not just in the narration.`
      : "";

  // Short Drama mode — Toonflow-inspired format:
  // Scene 1: Setup — establish characters & world fast
  // Scene 2: Inciting Incident — something disrupts everything
  // Scene 3: Rising Tension — stakes escalate, conflict deepens
  // Scene 4: Confrontation / Twist — the moment of revelation or clash
  // Scene 5: Cliffhanger or Resolution — leave them wanting more (or tie it off)
  const isDrama = req.scriptMode === "drama" && !!req.storyPremise;
  const genreLabel = req.genre ?? "drama";
  const charALabel = req.characterA?.trim() || "Character A";
  const charBLabel = req.characterB?.trim() || "Character B";
  const dramaBlock = isDrama
    ? `\n\nThis is a SHORT DRAMA — a ${genreLabel} story told in exactly 5 scenes. Write it like a storyboard for an animated short: vivid, cinematic, character-driven. Every line should feel like it belongs on screen.

Characters:
- ${charALabel} — the protagonist. Describe them physically once in Scene 1's visualPrompt and reuse the EXACT same description in every scene they appear. Never write "the same character" — spell it out completely each time.
- ${charBLabel} — the second lead. Same rule: locked physical description, repeated fully in every visualPrompt.

Write EXACTLY 5 scenes:

SCENE 1 — SETUP: Drop into the world mid-moment. Establish ${charALabel} and ${charBLabel}'s dynamic immediately. No exposition dumps — show, don't tell. End with a hint that something is about to change.

SCENE 2 — INCITING INCIDENT: Something happens that shatters the status quo. Surprise the viewer. Keep it visual. Every word of narration should feel urgent.

SCENE 3 — RISING TENSION: Stakes escalate. ${charALabel} and ${charBLabel} clash, ally, or discover something that makes it worse. Short punchy sentences. The viewer should feel the pressure building.

SCENE 4 — CONFRONTATION / TWIST: The scene everyone came for. A revelation, a betrayal, a decision, a moment of no return. Make it land hard. One line that recontextualizes everything before it.

SCENE 5 — CLIFFHANGER OR RESOLUTION: If ${genreLabel} calls for it, end on a gut-punch cliffhanger that makes them want episode 2. If it's a complete story, close with one resonant line that sticks. No summaries. No "and that's how…" — just the moment.

Premise: ${req.storyPremise}

Visual prompts must use ${req.style} art style. Each scene's visualPrompt must be fully self-contained: describe both characters fully (appearance, clothing, expression), the setting, the action, and the emotional tone of the frame.`
    : "";

  // Consistency for illustrated styles: Pollinations has no memory
  // between image calls, so if scene visualPrompts just say "the same
  // character as before" the image generator has nothing to work with
  // and every shot drifts. The fix is to make Groq do the consistency
  // work up front — lock a character/setting description once, then
  // write that FULL description into every single scene's visualPrompt
  // that features them, spelled out completely each time rather than
  // referenced by name. Repetitive on purpose: each image prompt must
  // stand alone.
  const consistencyBlock = `\n\nBefore writing scenes: privately decide on a locked character description (hair, skin tone, clothing, build — driven by this specific topic, not generic defaults) for any recurring character, and a locked setting description (palette, key elements, lighting) for any setting the script revisits. Then, for every scene's "visualPrompt", write out the COMPLETE character and setting description in full every single time they appear — never a shorthand reference like "the same character" or "Scene 2's setting." Each visualPrompt is used in total isolation by an image generator with no memory of other scenes, so it must be a fully self-contained description on its own: character (if present) fully described, setting fully described, pose/action, expression, and framing — every time, even if that means repeating the same sentences across many scenes.`;

  const systemPrompt = `You write scripts for ${req.style} short-form videos.
${SCRIPT_INSTRUCTION}${consistencyBlock}
Output ONLY valid JSON matching this shape, no other text:
{"title": string, "scenes": [{"text": string, "visualPrompt": string}]}
Write exactly ${sceneCount} scenes, ~${targetWordCount} words total narration.${trendBlock}${hybridBlock}${remixBlock}${comparisonBlock}${dramaBlock}`;

  const regenerateBlock =
    attempt > 0
      ? `\n\nThis is a regeneration — the previous draft was rejected. Write a genuinely different take: a different opening scenario/hook, different specific facts or examples, different structural choices within the required beats. Do not reuse phrasing, sentences, or the same specific examples from a typical first-pass answer to this topic.`
      : "";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      // Without an explicit temperature, regenerating with an identical
      // prompt could return an almost identical script — this is what
      // was causing "regenerate" to not actually change anything.
      temperature: attempt > 0 ? 1.1 : 0.9,
      // Default max_tokens on Groq is 1024 — far too small for a 5-scene
      // script with fully self-contained visualPrompts (each one repeats
      // the complete character + setting description). 4096 gives plenty
      // of headroom without hitting Groq free-tier rate limits.
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt + regenerateBlock },
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
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed: { title: string; scenes: { text: string; visualPrompt: string }[] } =
    JSON.parse(text);

  onLog?.(`Groq: script drafted — "${parsed.title}" (${parsed.scenes.length} scenes)`, "groq");

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
