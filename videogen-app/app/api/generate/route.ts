import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { GenerateRequest } from "../../../lib/types";
import { createJob, setJobStatus, updateJob, setJobFailed, getJob, waitForApproval, logActivity } from "../../../lib/jobs";
import { generateScriptGroq } from "../../../lib/providers/script-groq";
import { buildScriptFromCustomText } from "../../../lib/providers/customScript";
import { generateVoiceover } from "../../../lib/providers/tts";
import { generateVisualsForScene } from "../../../lib/providers/visuals";
import { composeVideo } from "../../../lib/providers/compose";
import { uploadVideo, uploadAudioPreview } from "../../../lib/providers/storage";

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

async function runPipeline(jobId: string) {
  const jobDir = path.join(os.tmpdir(), "videogen", jobId);
  const job = getJob(jobId);
  if (!job) throw new Error("Job disappeared");

  // ── Script ──────────────────────────────────────────────
  // Loops back and rewrites from scratch each time the user hits
  // "Try again" instead of "Approve" — same generation call, just
  // repeated, so a regenerate always gets a fresh attempt.
  let script;
  while (true) {
    setJobStatus(jobId, "writing_script", "Writing the script...");
    script =
      job.request.scriptMode === "custom"
        ? buildScriptFromCustomText(job.request.customScript!, job.request)
        : await generateScriptGroq(job.request, (text, service) => logActivity(jobId, text, service));
    updateJob(jobId, { script });

    const decision = await waitForApproval(jobId, "script");
    if (decision === "approve") break;
  }

  // ── Voiceover ───────────────────────────────────────────
  let voiceoverPath: string;
  let voiceoverPreviewUrl: string;
  while (true) {
    setJobStatus(jobId, "generating_voiceover", "Recording the voiceover...");
    voiceoverPath = await generateVoiceover(
      script.fullNarrationText,
      jobDir,
      {
        gender: job.request.voiceGender,
        voiceName: job.request.voiceName,
        pace: job.request.voicePace,
      },
      (text, service) => logActivity(jobId, text, service)
    );
    logActivity(jobId, "Cloudinary: uploading voiceover preview", "cloudinary");
    voiceoverPreviewUrl = await uploadAudioPreview(voiceoverPath);
    updateJob(jobId, { voiceoverPath, voiceoverPreviewUrl });

    const decision = await waitForApproval(jobId, "voice");
    if (decision === "approve") break;
  }

  // ── Visuals (no approval checkpoint — moves straight through) ──
  setJobStatus(jobId, "generating_visuals", "Selecting footage...");
  for (const scene of script.scenes) {
    setJobStatus(
      jobId,
      "generating_visuals",
      `Selecting footage — scene ${scene.index + 1} of ${script.scenes.length}...`
    );
    scene.visualAssetPaths = await generateVisualsForScene(
      scene,
      jobDir,
      job.request.style,
      (text, service) => logActivity(jobId, text, service)
    );
  }
  updateJob(jobId, { script });

  // ── Compose + upload ────────────────────────────────────
  setJobStatus(jobId, "composing", "Editing the final cut...");
  const localOutputPath = path.join(jobDir, "final.mp4");
  await composeVideo(script, voiceoverPath, localOutputPath, (text) =>
    logActivity(jobId, text, "ffmpeg")
  );

  setJobStatus(jobId, "uploading", "Saving your video...");
  const videoUrl = await uploadVideo(localOutputPath, script.title, (text) =>
    logActivity(jobId, text, "cloudinary")
  );

  updateJob(jobId, { status: "done", outputVideoPath: videoUrl, progressNote: "Done!" });
}
