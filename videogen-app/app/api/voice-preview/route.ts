import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { generateVoiceover, VoiceGender, VoicePace } from "../../../lib/providers/tts";

// A short, neutral sample line — long enough to judge tone/pacing,
// short enough to synthesize almost instantly, so this can run every
// time someone changes the voice/pace dropdowns without feeling slow.
const SAMPLE_SENTENCE =
  "Hi, this is a quick preview of how this voice sounds at this speed, narrating your video.";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    voiceGender?: VoiceGender;
    voiceName?: string;
    voicePace?: VoicePace;
  };

  const previewDir = path.join(os.tmpdir(), "videogen-voice-preview", crypto.randomUUID());

  try {
    const audioPath = await generateVoiceover(SAMPLE_SENTENCE, previewDir, {
      gender: body.voiceGender,
      voiceName: body.voiceName,
      pace: body.voicePace,
    });

    const buffer = fs.readFileSync(audioPath);
    const contentType = audioPath.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    fs.rm(previewDir, { recursive: true, force: true }, () => {});
  }
}
