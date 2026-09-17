import { NextRequest, NextResponse } from "next/server";
import { GenerateRequest } from "../../../lib/types";
import { createJob, setJobFailed } from "../../../lib/jobs";
import { runPipeline } from "../../../lib/pipeline";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateRequest;

  if (!body.topic || !body.style || !body.targetLengthSeconds) {
    return NextResponse.json(
      { error: "topic, style, and targetLengthSeconds are all required." },
      { status: 400 }
    );
  }

  if (body.scriptMode === "custom" && !body.customScript?.trim()) {
    return NextResponse.json(
      { error: "Custom script mode requires customScript text." },
      { status: 400 }
    );
  }

  const job = createJob(body);

  runPipeline(job.id).catch((err) => {
    setJobFailed(job.id, err instanceof Error ? err.message : String(err));
  });

  return NextResponse.json({ jobId: job.id });
}
