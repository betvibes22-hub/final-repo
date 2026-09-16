import fs from "fs";
import path from "path";
import { generateVoiceoverPiper, listAvailableVoices as listPiperVoices, VoiceGender, VoicePace, VoiceOptions } from "./piperTts";

export type { VoiceGender, VoicePace, VoiceOptions } from "./piperTts";

/**
 * Voiceover generation — Piper (self-hosted, unlimited, 20 real voices)
 * is the primary path; see piperTts.ts for why. VoiceRSS remains here
 * purely as an automatic fallback if Piper's install/download/synthesis
 * fails for any reason on a given run, so a voiceover still gets made.
 * Its own 5-voice limit is the reason it's no longer primary.
 */
export function listAvailableVoices() {
  return listPiperVoices();
}

export async function generateVoiceover(
  text: string,
  outDir: string,
  options: VoiceOptions = {}
): Promise<string> {
  try {
    return await generateVoiceoverPiper(text, outDir, options);
  } catch (err) {
    console.error("Piper TTS failed, falling back to VoiceRSS:", err);
    return await generateVoiceoverVoiceRSS(text, outDir, options);
  }
}

const VOICERSS_VOICES_BY_GENDER: Record<VoiceGender, string[]> = {
  female: ["Linda", "Amy", "Mary"],
  male: ["John", "Mike"],
};

const VOICERSS_PACE_RATE: Record<VoicePace, number> = {
  slower: -3,
  normal: 0,
  faster: 3,
};

async function generateVoiceoverVoiceRSS(
  text: string,
  outDir: string,
  options: VoiceOptions = {}
): Promise<string> {
  const apiKey = process.env.VOICERSS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Piper failed and VOICERSS_API_KEY is not set, so there's no fallback available. Get a free VoiceRSS key at voicerss.org/registration.aspx — see .env.example."
    );
  }

  const gender = options.gender ?? "female";
  const validNames = VOICERSS_VOICES_BY_GENDER[gender];
  const voiceName = validNames[0]; // Piper voice names don't map to VoiceRSS's catalog
  const rate = VOICERSS_PACE_RATE[options.pace ?? "normal"];

  const params = new URLSearchParams({
    key: apiKey,
    src: text,
    hl: "en-us",
    v: voiceName,
    r: String(rate),
    c: "MP3",
    f: "44khz_16bit_stereo",
  });

  const response = await fetch(`https://api.voicerss.org/?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`VoiceRSS TTS failed: ${response.status} ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  const preview = Buffer.from(arrayBuffer.slice(0, 200)).toString("utf-8");
  if (preview.startsWith("ERROR")) {
    throw new Error(`VoiceRSS TTS failed: ${preview}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "voiceover.mp3");
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  return outPath;
}
