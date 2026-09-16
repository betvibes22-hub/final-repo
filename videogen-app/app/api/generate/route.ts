import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { GenerateRequest } from "../../../lib/types";
import { createJob, setJobStatus, updateJob, setJobFailed } from "../../../lib/jobs";
import { generateScriptGroq as generateScript } from "../../../lib/providers/script-groq";
import { generateVoiceover } from "../../../lib/providers/tts";
import { generateVisualForScene } from "../../../lib/providers/visuals";
import { composeVideo } from "../../../lib/providers/compose";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateRequest;

  if (!body.topic || !body.style || !body.targetLengthSeconds) {
    return NextResponse.json(
      { error: "topic, style, and targetLengthSeconds are all required." },
      { status: 400 }
    );
  }

  const job = createJob(body);

  // Run the pipeline in the background — respond immediately with the job id
  // so the frontend can poll /api/status. This is intentionally NOT awaited.
  runPipeline(job.id).catch((err) => {
    setJobFailed(job.id, err instanceof Error ? err.message : String(err));
  });

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(jobId: string) {
  const jobDir = path.join(process.cwd(), "public", "outputs", jobId);
  const job = (await import("../../../lib/jobs")).getJob(jobId);
  if (!job) throw new Error("Job disappeared");

  // 1. Script
  setJobStatus(jobId, "writing_script", "Writing the script...");
  const script = await generateScript(job.request);
  updateJob(jobId, { script });

  // 2. Voiceover
  setJobStatus(jobId, "generating_voiceover", "Recording the voiceover...");
  const voiceoverPath = await generateVoiceover(script.fullNarrationText, jobDir);
  updateJob(jobId, { voiceoverPath });

  // 3. Visuals (one per scene, sequentially — parallelize later if your
  //    provider's rate limits allow it)
  setJobStatus(jobId, "generating_visuals", "Generating visuals...");
  for (const scene of script.scenes) {
    setJobStatus(
      jobId,
      "generating_visuals",
      `Generating visuals — scene ${scene.index + 1} of ${script.scenes.length}...`
    );
    const assetPath = await generateVisualForScene(scene, jobDir);
    scene.visualAssetPath = assetPath;
  }
  updateJob(jobId, { script }); // scenes now carry visualAssetPath

  // 4. Compose
  setJobStatus(jobId, "composing", "Stitching the final video...");
  const outputPath = path.join(jobDir, "final.mp4");
  await composeVideo(script, voiceoverPath, outputPath);

  // Public URL path (served from /public/outputs/...)
  const publicPath = `/outputs/${jobId}/final.mp4`;
  updateJob(jobId, { status: "done", outputVideoPath: publicPath, progressNote: "Done!" });
}
