import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { getJob, updateJob, setJobStatus, setJobFailed, logActivity } from "../../../lib/jobs";
import { generateVisualsForScene, deriveStyleSeed } from "../../../lib/providers/visuals";
import { composeVideo } from "../../../lib/providers/compose";
import { uploadVideo } from "../../../lib/providers/storage";

/**
 * "More access to the editing" — redo just one scene's visuals (new
 * stock footage / new AI illustration) without starting the whole
 * video over. Re-uses the same job directory and voiceover the
 * original generation produced, swaps in fresh visuals for the one
 * scene, and recomposes — script and narration are untouched.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { jobId?: string; sceneIndex?: number };
  const { jobId, sceneIndex } = body;

  if (!jobId || sceneIndex === undefined) {
    return NextResponse.json({ error: "jobId and sceneIndex are both required." }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (!job.script || !job.voiceoverPath) {
    return NextResponse.json({ error: "This job hasn't finished its first generation yet." }, { status: 400 });
  }
  const scene = job.script.scenes.find((s) => s.index === sceneIndex);
  if (!scene) {
    return NextResponse.json({ error: `Scene ${sceneIndex} not found on this job.` }, { status: 404 });
  }
  if (job.status !== "done" && job.status !== "failed") {
    return NextResponse.json({ error: "This job is still busy — wait for it to finish first." }, { status: 409 });
  }

  // Respond immediately; redo the scene + recompose in the background,
  // same fire-and-forget pattern as the main /api/generate route. The
  // frontend keeps polling /api/status, same as it already does.
  regenerateScene(job.id, sceneIndex).catch((err) => {
    console.error(`Scene regeneration failed for job ${job.id}, scene ${sceneIndex}:`, err);
    setJobFailed(job.id, err instanceof Error ? err.message : String(err));
  });

  return NextResponse.json({ jobId: job.id });
}

async function regenerateScene(jobId: string, sceneIndex: number) {
  const job = getJob(jobId);
  if (!job || !job.script || !job.voiceoverPath) return;

  const jobDir = path.join(os.tmpdir(), "videogen", jobId);
  const scene = job.script.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return;

  setJobStatus(jobId, "generating_visuals", `Redoing scene ${sceneIndex + 1}...`);
  logActivity(jobId, `Redoing scene ${sceneIndex + 1} — fetching fresh visuals`, "pixabay");

  const styleSeed = deriveStyleSeed(job.script.title) + Date.now() % 1000; // nudge the seed so a redo doesn't just fetch the exact same result
  scene.visualAssetPaths = await generateVisualsForScene(
    scene,
    jobDir,
    job.request.style,
    (text, service) => logActivity(jobId, text, service),
    styleSeed
  );
  updateJob(jobId, { script: job.script });

  setJobStatus(jobId, "composing", "Re-editing the final cut...");
  const localOutputPath = path.join(jobDir, "final.mp4");
  await composeVideo(job.script, job.voiceoverPath, localOutputPath, (text) => logActivity(jobId, text, "ffmpeg"));

  setJobStatus(jobId, "uploading", "Saving your updated video...");
  const videoUrl = await uploadVideo(localOutputPath, job.script.title, (text) => logActivity(jobId, text, "cloudinary"));

  updateJob(jobId, { status: "done", outputVideoPath: videoUrl, progressNote: undefined });
}
