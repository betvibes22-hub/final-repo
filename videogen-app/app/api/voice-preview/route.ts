import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { generateVoiceover, VoiceGender, VoicePace } from "../../../lib/providers/tts";

// A short, neutral sample line — long enough to judge tone/pacing,
// short enough to synthesize almost instantly.
const SAMPLE_SENTENCE =
  "Hi, this is a quick preview of how this voice sounds at this speed, narrating your video.";

// Persistent cache: generated once per voice+pace combo, reused forever
// while the instance is running. The key encodes voice + pace so every
// unique combination gets its own file. This turns "first user of each
// voice pays the synthesis cost, everyone else gets it instantly" —
// the same pattern already used for Piper model downloads.
const PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "videogen-voice-preview-cache");

function cacheKey(voiceName: string, pace: string): string {
  // Strip non-alphanumeric to keep filenames safe; pace appended so
  // "Amy slower" ≠ "Amy normal".
  return `${voiceName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${pace}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    voiceGender?: VoiceGender;
    voiceName?: string;
    voicePace?: VoicePace;
  };

  const voiceName = body.voiceName ?? "en_US-amy-medium";
  const pace = body.voicePace ?? "normal";
  const key = cacheKey(voiceName, pace);

  fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true });

  // Check for a cached .wav or .mp3 from a previous synthesis.
  const cachedWav = path.join(PREVIEW_CACHE_DIR, `${key}.wav`);
  const cachedMp3 = path.join(PREVIEW_CACHE_DIR, `${key}.mp3`);

  let audioPath: string | null = null;
  if (fs.existsSync(cachedWav)) audioPath = cachedWav;
  else if (fs.existsSync(cachedMp3)) audioPath = cachedMp3;

  if (!audioPath) {
    // First request for this combo — synthesize and cache.
    const synthDir = path.join(PREVIEW_CACHE_DIR, key);
    fs.mkdirSync(synthDir, { recursive: true });
    try {
      const synthesized = await generateVoiceover(SAMPLE_SENTENCE, synthDir, {
        gender: body.voiceGender,
        voiceName: body.voiceName,
        pace: body.voicePace,
      });
      // Move the file into the top-level cache dir under the stable key name.
      const ext = synthesized.toLowerCase().endsWith(".wav") ? "wav" : "mp3";
      const dest = path.join(PREVIEW_CACHE_DIR, `${key}.${ext}`);
      fs.renameSync(synthesized, dest);
      audioPath = dest;
    } finally {
      // Clean up the temp synthesis dir (the output was already moved out).
      fs.rm(synthDir, { recursive: true, force: true }, () => {});
    }
  }

  if (!audioPath) {
    return NextResponse.json({ error: "Preview synthesis failed." }, { status: 500 });
  }

  const buffer = fs.readFileSync(audioPath);
  const contentType = audioPath.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Short browser cache — stale previews during a deploy are not a
      // problem but we don't want the browser re-downloading every page load.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
