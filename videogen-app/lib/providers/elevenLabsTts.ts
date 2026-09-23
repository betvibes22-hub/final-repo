/**
 * ElevenLabs TTS provider — primary voice synthesis engine.
 *
 * Uses ElevenLabs premade voices (always available on all plans, no
 * extra credits required beyond the monthly allowance). These are the
 * same voices used by Pictory, InVideo, Opus Clip and other top-tier
 * AI video platforms.
 *
 * Activated when ELEVENLABS_API_KEY is set as an environment variable.
 * Falls back to Piper (piperTts.ts) when the key is absent.
 */

import fs from "fs";
import path from "path";
import { VoiceGender, VoicePace } from "./piperTts";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_multilingual_v2";

interface ElevenLabsVoiceDef {
  voiceId: string;
  displayName: string;
  gender: VoiceGender;
}

/**
 * Premade ElevenLabs voices — available on every plan (Free through Scale).
 * 5 female + 5 male, all English-optimised, clear and natural-sounding.
 */
export const ELEVENLABS_VOICES: ElevenLabsVoiceDef[] = [
  // ── Female ──────────────────────────────────────────────────────────────
  { voiceId: "hpp4J3VqNfWAUOO0d1Us", displayName: "Bella",   gender: "female" },
  { voiceId: "FGY2WhTYpPnrIDTdsKH5", displayName: "Laura",   gender: "female" },
  { voiceId: "Xb7hH8MSUJpSbSDYk0k2", displayName: "Alice",   gender: "female" },
  { voiceId: "XrExE9yKIg1WjnnlVkGX", displayName: "Matilda", gender: "female" },
  { voiceId: "pFZP5JQG7iQjIQuC4Bku", displayName: "Lily",    gender: "female" },
  // ── Male ────────────────────────────────────────────────────────────────
  { voiceId: "TX3LPaxmHKxFdv7VOQHJ", displayName: "Liam",   gender: "male" },
  { voiceId: "nPczCjzI2devNBz1zQrb", displayName: "Brian",  gender: "male" },
  { voiceId: "JBFqnCBsd6RMkjVDRZzb", displayName: "George", gender: "male" },
  { voiceId: "onwK4e9ZLuTAKqWW03F9", displayName: "Daniel", gender: "male" },
  { voiceId: "pNInz6obpgDQGcFmaJgB", displayName: "Adam",   gender: "male" },
];

/** Returns true when the API key is available at runtime. */
export function isElevenLabsAvailable(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Synthesise narration text via ElevenLabs TTS.
 *
 * @param text      - full narration script
 * @param outDir    - directory to write the MP3 into
 * @param options   - gender / voiceName (voiceId or display name) / pace
 * @param onLog     - optional progress callback
 * @returns absolute path to the output MP3
 */
export async function generateVoiceoverElevenLabs(
  text: string,
  outDir: string,
  options: { gender?: VoiceGender; voiceName?: string; pace?: VoicePace } = {},
  onLog?: (text: string) => void
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  const gender = options.gender ?? "female";
  const candidates = ELEVENLABS_VOICES.filter((v) => v.gender === gender);

  // Match by voiceId or display name (case-insensitive); fall back to first candidate
  const def =
    candidates.find(
      (v) =>
        v.voiceId === options.voiceName ||
        v.displayName.toLowerCase() === (options.voiceName ?? "").toLowerCase()
    ) ?? candidates[0];

  onLog?.(`ElevenLabs: synthesizing with voice "${def.displayName}" (${def.voiceId})…`);

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${def.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.50,          // natural variance without robotic flatness
        similarity_boost: 0.75,   // crisp character adherence
        style: 0.0,               // no exaggerated emotion — clean narration
        use_speaker_boost: true,  // enhances clarity for voiceover use-cases
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "voiceover.mp3");
  const buf = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outPath, buf);

  onLog?.(`ElevenLabs: narration ready — ${(buf.length / 1024).toFixed(0)} KB`);
  return outPath;
}
