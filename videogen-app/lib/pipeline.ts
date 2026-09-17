import path from "path";
import os from "os";
import { setJobStatus, updateJob, setJobFailed, getJob, waitForApproval, logActivity } from "./jobs";
import { generateScriptGroq } from "./providers/script-groq";
import { buildScriptFromCustomText } from "./providers/customScript";
import { generateVoiceover } from "./providers/tts";
import { generateVisualsForScene, deriveStyleSeed } from "./providers/visuals";
import { composeVideo } from "./providers/compose";
import { uploadVideo, uploadAudioPreview, uploadThumbnail } from "./providers/storage";
import { generateVideoMetadata, generateThumbnail } from "./providers/metadata";

/**
 * The full script → voiceover → visuals → compose → upload pipeline,
 * shared by every entry point that creates a job (the normal generator
 * and the video-remix upload flow) so there's exactly one place this
 * logic lives.
 */
export async function runPipeline(jobId: string) {
  const jobDir = path.join(os.tmpdir(), "videogen", jobId);
  const job = getJob(jobId);
  if (!job) throw new Error("Job disappeared");

  // ── Script ──────────────────────────────────────────────
  // Loops back and rewrites from scratch each time the user hits
  // "Try again" instead of "Approve" — same generation call, just
  // repeated, so a regenerate always gets a fresh attempt.
  let script;
  let scriptAttempt = 0;
  while (true) {
    setJobStatus(jobId, "writing_script", "Writing the script...");
    script =
      job.request.scriptMode === "custom"
        ? buildScriptFromCustomText(job.request.customScript!, job.request)
        : await generateScriptGroq(job.request, (text, service) => logActivity(jobId, text, service), scriptAttempt);
    updateJob(jobId, { script });

    const decision = await waitForApproval(jobId, "script");
    if (decision === "approve") break;
    scriptAttempt++;
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
  // One seed per video (from the title) so every scene's AI illustration
  // shares a similar look, rather than a differently-seeded random image
  // each time — see deriveStyleSeed's docstring for what this can and
  // can't achieve for a free, keyless image API.
  const styleSeed = deriveStyleSeed(script.title);
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
      (text, service) => logActivity(jobId, text, service),
      styleSeed
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

  // Metadata package (title/description/tags/thumbnail) — best-effort:
  // a failure here shouldn't fail the whole job, the video itself is
  // already done and saved.
  let metaTitle: string | undefined;
  let metaDescription: string | undefined;
  let metaTags: string[] | undefined;
  let thumbnailUrl: string | undefined;
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      const meta = await generateVideoMetadata(script, apiKey, (text, service) =>
        logActivity(jobId, text, service)
      );
      metaTitle = meta.title;
      metaDescription = meta.description;
      metaTags = meta.tags;

      const thumbPath = await generateThumbnail(meta.thumbnailPrompt, jobDir, (text, service) =>
        logActivity(jobId, text, service)
      );
      thumbnailUrl = await uploadThumbnail(thumbPath, (text) => logActivity(jobId, text, "cloudinary"));
    }
  } catch (err) {
    console.error(`Metadata/thumbnail generation failed for job ${jobId} (non-fatal):`, err);
  }

  updateJob(jobId, {
    status: "done",
    outputVideoPath: videoUrl,
    progressNote: "Done!",
    metaTitle,
    metaDescription,
    metaTags,
    thumbnailUrl,
  });
}
