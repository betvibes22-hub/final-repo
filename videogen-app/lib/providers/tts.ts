import fs from "fs";
import path from "path";

/**
 * Generates a voiceover MP3 from text using VoiceRSS — genuinely free,
 * no credit card, 350 requests/day.
 *
 * Voice selection: VoiceRSS's English (US) voices are Linda, Amy, Mary
 * (female) and John, Mike (male) — that's the real, documented list.
 * VoiceRSS does not track an "age" attribute at all, so rather than
 * fake a young/old label that isn't real, pace (speech rate) is exposed
 * instead — a genuine, documented parameter that meaningfully changes
 * how a voice feels.
 */
export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";

const VOICES_BY_GENDER: Record<VoiceGender, string[]> = {
  female: ["Linda", "Amy", "Mary"],
  male: ["John", "Mike"],
};

const PACE_RATE: Record<VoicePace, number> = {
  slower: -3,
  normal: 0,
  faster: 3,
};

export interface VoiceOptions {
  gender?: VoiceGender;
  voiceName?: string; // must be one of VOICES_BY_GENDER[gender]; falls back to the first if mismatched
  pace?: VoicePace;
}

export function listAvailableVoices() {
  return VOICES_BY_GENDER;
}

export async function generateVoiceover(
  text: string,
  outDir: string,
  options: VoiceOptions = {}
): Promise<string> {
  const apiKey = process.env.VOICERSS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOICERSS_API_KEY is not set. Get a free key at voicerss.org/registration.aspx — see .env.example."
    );
  }

  const gender = options.gender ?? "female";
  const validNames = VOICES_BY_GENDER[gender];
  const voiceName =
    options.voiceName && validNames.includes(options.voiceName) ? options.voiceName : validNames[0];
  const rate = PACE_RATE[options.pace ?? "normal"];

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
