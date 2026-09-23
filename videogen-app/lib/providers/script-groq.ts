import { GenerateRequest, Script, Scene } from "../types";
import { getTrendContext } from "./trends";

const SCRIPT_INSTRUCTION = `Write a gripping, high-retention short-form video script. Every script MUST follow these rules without exception:

1. COLD OPEN — No "in this video," no "today we're looking at," no title restating. Drop the viewer directly into a specific, sensory, high-stakes moment. Start mid-action. The first sentence should make someone stop scrolling.

2. SPECIFIC FACTS ONLY — Every claim needs a name, number, date, or place. Never write "a long time ago" — write the year. Never "scientists discovered" — name the scientist. Never "many people" — give a real figure. Vague claims are cut.

3. SENTENCE RHYTHM — Mix long sentences with sudden short punches. Fragment. Two words. Then a longer sentence to breathe and expand before the next short hit. Rhythm is what keeps people listening.

4. BUILD TENSION — Every scene should plant a question the viewer needs answered. Seed a specific detail early. Pay it off later. Make them need to reach the end.

5. NO FILLER — Cut every word that could be removed without losing information. "The fact that" → cut. "It is worth noting that" → cut. "Interestingly" → cut. Every single sentence earns its place or it goes.

6. PUNCHY CLOSER — End with one resonant line that zooms out — not a summary, not a "so what did we learn today," just a gut-punch final beat that sticks.`;

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
  const targetWordCount = Math.round(req.targetLengthSeconds * 2.5);
  const sceneCount =
    isComparison || req.scriptMode === "drama" ? 5 : Math.max(3, Math.round(req.targetLengthSeconds / 15));
  onLog?.(`Groq: drafting ${sceneCount}-scene script (~${targetWordCount} words)`, "groq");

  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search interest around this topic — weave in whichever genuinely fit:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  const draftWordCount = req.customScript?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const hybridBlock =
    req.scriptMode === "hybrid" && req.customScript?.trim()
      ? `\n\nThe user wrote a rough draft below (${draftWordCount} words). It is a starting point ONLY — it is too short/thin on its own. Do NOT simply repeat, lightly rephrase, or return it unchanged. You MUST substantially rewrite and expand it to reach ~${targetWordCount} words: keep their core ideas, topic, and tone, but add narrative detail, concrete examples, transitions between beats, and depth on each point so it reads like a fully produced script, not a draft. If the draft doesn't specify a structure, write it as a well-paced explainer with a hook, build-up, and payoff. Their draft:\n"""\n${req.customScript.trim()}\n"""`
      : "";

  const remixBlock =
    req.scriptMode === "remix" && req.remixTranscript?.trim()
      ? `\n\nBelow is a transcript of a video the user wants to remake in their own style. Study its TOPIC, STRUCTURE, and PACING only — the
