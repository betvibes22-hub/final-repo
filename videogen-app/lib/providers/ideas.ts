import { getTrendContext } from "./trends";

export interface VideoIdea {
  title: string;
  reason: string;
}

const NICHE_LABELS: Record<string, string> = {
  "ancient-humans": "Ancient humans / human evolution & survival",
  "forbidden-food": "Forbidden food / predator-meat / why-don't-we-eat-X",
  psychology: "Psychology / named phenomena",
  "dark-history": "Dark or brutal history — untold, disturbing, overlooked stories",
  space: "Space & unexplained mysteries",
  "animal-behavior": "Animal behavior / predator-prey dynamics",
};

/**
 * Suggests 5 video ideas for a chosen niche, in the title-formula style
 * proven for evidence-dense explainer channels — a curiosity gap or
 * stark comparison, never giving the answer away in the title itself.
 * Pulls real current search context via Tavily first (same free trend
 * lookup already used for script writing) so ideas lean toward what's
 * actually being discussed right now, not just generic niche staples.
 */
export async function suggestVideoIdeas(
  niche: string,
  apiKey: string,
  onLog?: (text: string, service: "groq" | "tavily") => void
): Promise<VideoIdea[]> {
  const nicheLabel = NICHE_LABELS[niche] ?? niche;

  onLog?.(`Tavily: checking what's currently trending in "${nicheLabel}"`, "tavily");
  const trendTerms = await getTrendContext(nicheLabel);

  const trendBlock =
    trendTerms.length > 0
      ? `\n\nReal current search results in this space right now — lean toward these where genuinely relevant:\n${trendTerms.map((t) => `- ${t}`).join("\n")}`
      : "";

  onLog?.(`Groq: drafting 5 video ideas for "${nicheLabel}"`, "groq");

  const systemPrompt = `You generate video ideas for the niche: "${niceLabelEscape(nicheLabel)}".
Generate exactly 5 ideas. Each title must:
- Follow a proven curiosity-gap formula: "What Did [Group] Do [X]?", "How Did [Group] Survive [X]?", "Why Did/Don't [Group/We] [X]?", or a second-person mirror hook ("...And Why You [Still] [X] Too")
- Never give away the answer in the title itself
- Be built around a genuine curiosity gap or a stark comparison/contradiction
- Be specific enough that it couldn't apply to four other different videos
- Be genuinely underexplored within this niche, not the most obvious/oversaturated angle${trendBlock}
Output ONLY valid JSON: {"ideas": [{"title": string, "reason": string}]} — "reason" is one short line on why it's likely to hook a viewer.`;

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
        { role: "user", content: `Give me 5 ideas for: ${nicheLabel}` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq idea generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed: { ideas: VideoIdea[] } = JSON.parse(text);

  onLog?.(`Groq: ${parsed.ideas.length} idea(s) ready`, "groq");
  return parsed.ideas;
}

function niceLabelEscape(s: string): string {
  return s.replace(/"/g, "'");
}
