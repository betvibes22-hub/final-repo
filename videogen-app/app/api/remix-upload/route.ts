import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { GenerateRequest, ScriptVibe, VideoStyle, VoiceGender, VoicePace } from "../../../lib/types";
import { createJob, setJobFailed, logActivity } from "../../../lib/jobs";
import { runPipeline } from "../../../lib/pipeline";
import { transcribeAudioGroq } from "../../../lib/providers/transcribe";

// Generous but bounded — long uploads mean a long compressed-audio
// extraction and a slower transcription call; this keeps the free
// Whisper request comfortably inside Groq's free-tier 25MB cap even
// before compression helps further.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A video file is required." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That video is too large — try something under 200MB." }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not set." }, { status: 500 });
  }

  const style = (form.get("style") as VideoStyle) || "realistic";
  const vibe = (form.get("vibe") as ScriptVibe) || "documentary";
  const targetLengthSeconds = Number(form.get("targetLengthSeconds")) || 45;
  const voiceGender = (form.get("voiceGender") as VoiceGender) || undefined;
  const voiceName = (form.get("voiceName") as string) || undefined;
  const voicePace = (form.get("voicePace") as VoicePace) || undefined;

  const workDir = path.join(os.tmpdir(), "videogen-remix-uploads", crypto.randomUUID());
  fs.mkdirSync(workDir, { recursive: true });
  const uploadPath = path.join(workDir, file.name || "upload.mp4");
  const audioPath = path.join(workDir, "audio.mp3");

  try {
    fs.writeFileSync(uploadPath, Buffer.from(await file.arrayBuffer()));

    // Compressed, mono, low-bitrate — this is what actually keeps most
    // uploads under Groq's free-tier 25MB transcription limit without
    // needing to chunk the file; a 10-minute video comes out well under
    // 5MB this way, versus however large the original video itself is.
    execFileSync(ffmpegPath.path, [
      "-y",
      "-i",
      uploadPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      audioPath,
    ]);

    const transcript = await transcribeAudioGroq(audioPath, apiKey);

    const request: GenerateRequest = {
      topic: "Remixed from an uploaded video",
      style,
      vibe,
      targetLengthSeconds,
      scriptMode: "remix",
      remixTranscript: transcript,
      voiceGender,
      voiceName,
      voicePace,
    };

    const job = createJob(request);
    logActivity(job.id, "Groq: transcribed uploaded video, writing an original script inspired by it", "groq");

    runPipeline(job.id).catch((err) => {
      setJobFailed(job.id, err instanceof Error ? err.message : String(err));
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}
