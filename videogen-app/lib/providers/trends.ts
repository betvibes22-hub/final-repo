/**
 * Pulls real, current context about a topic using Tavily
 * (tavily.com) — genuinely free, recurring: 1,000 credits every
 * month, no credit card required. This is what makes the script
 * trend-aware: instead of the LLM guessing what's relevant right
 * now, we hand it real current search results before it writes a
 * single word of the script.
 *
 * Fully optional — if no key is set, scripting still works fine,
 * it just skips this enrichment step.
 */
export async function getTrendContext(topic: string): Promise<string[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: topic,
        max_results: 6,
      }),
    });

    if (!response.ok) {
      console.error(`Tavily trend lookup failed: ${response.status}`);
      return [];
    }

    const data = await response.json();

    // Pull result titles as current-context signals — what's actually
    // being published/discussed about this topic right now.
    const titles: string[] = (data.results ?? []).map(
      (r: { title: string }) => r.title
    );

    return titles.slice(0, 6);
  } catch (err) {
    console.error("Trend lookup error:", err);
    return [];
  }
}
