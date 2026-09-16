import { NextRequest, NextResponse } from "next/server";
import { approveStage, ApprovalDecision } from "../../../lib/jobs";

export async function POST(req: NextRequest) {
  const { jobId, stage, decision } = await req.json();

  if (!jobId || !stage) {
    return NextResponse.json({ error: "jobId and stage are required." }, { status: 400 });
  }

  const resolvedDecision: ApprovalDecision = decision === "regenerate" ? "regenerate" : "approve";
  const ok = approveStage(jobId, stage, resolvedDecision);
  if (!ok) {
    return NextResponse.json({ error: "No pending approval found for that job/stage." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
