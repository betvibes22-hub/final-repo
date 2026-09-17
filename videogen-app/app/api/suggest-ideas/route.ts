import { NextRequest, NextResponse } from "next/server";
import { suggestVideoIdeas } from "../../../lib/providers/ideas";

export async function POST(req: NextRequest) {
  const { niche } = (await req.json()) as { niche?: string };
  if (!niche) {
    return NextResponse.json({ error: "niche is required." }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not set." }, { status: 500 });
  }

  try {
    const ideas = await suggestVideoIdeas(niche, apiKey);
    return NextResponse.json({ ideas });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
