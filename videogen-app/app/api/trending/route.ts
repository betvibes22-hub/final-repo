import { NextResponse } from "next/server";
import { getTrendingShorts } from "../../../lib/providers/trending";

export async function GET() {
  const videos = await getTrendingShorts();
  return NextResponse.json({ videos });
}
