import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { GenerateRequest } from "../../../lib/types";
import { createJob, setJobStatus, updateJob, setJobFailed, getJob } from "../../../lib/jobs";
import { generateScriptGroq } from "../../../lib/providers/script-groq";
import { buildScriptFromCustomText } from "../../../lib/providers/customScript";
import { generateVoiceover } from "../../../lib/providers/tts";
import { generateVisualsForScene } from "../../../lib/providers/visuals";
import { composeVideo } from "../../../lib/providers/compose";
import { uploadVideo } from "../../../lib/providers/storage";

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

  setJobStatus(jobId, "writing_script", "Writing the script...");
  const script =
    job.request.scriptMode === "custom"
      ? buildScriptFromCustomText(job.request.customScript!, job.request)
      : await generateScriptGroq(job.request); // handles "ai" and "hybrid" internally
  updateJob(jobId, { script });

  setJobStatus(jobId, "generating_voiceover", "Recording the voiceover...");
  const voiceoverPath = await generateVoiceover(script.fullNarrationText, jobDir, {
    gender: job.request.voiceGender,
    voiceName: job.request.voiceName,
    pace: job.request.voicePace,
  });
  updateJob(jobId, { voiceoverPath });

  setJobStatus(jobId, "generating_visuals", "Selecting footage...");
  for (const scene of script.scenes) {
    setJobStatus(
      jobId,
      "generating_visuals",
      `Selecting footage — scene ${scene.index + 1} of ${script.scenes.length}...`
    );
    scene.visualAssetPaths = await generateVisualsForScene(scene, jobDir);
  }
  updateJob(jobId, { script });

  setJobStatus(jobId, "composing", "Editing the final cut...");
  const localOutputPath = path.join(jobDir, "final.mp4");
  await composeVideo(script, voiceoverPath, localOutputPath);

  setJobStatus(jobId, "uploading", "Saving your video...");
  const videoUrl = await uploadVideo(localOutputPath, script.title);

  updateJob(jobId, { status: "done", outputVideoPath: videoUrl, progressNote: "Done!" });
}
