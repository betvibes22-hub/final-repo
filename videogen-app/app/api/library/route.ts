import { NextResponse } from "next/server";
import { listPastVideos } from "../../../lib/providers/library";

export async function GET() {
  const videos = await listPastVideos();
  return NextResponse.json({ videos });
}
