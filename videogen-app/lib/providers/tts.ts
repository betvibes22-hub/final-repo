import fs from "fs";
import path from "path";

/**
 * Generates a voiceover MP3 from text using VoiceRSS — genuinely free,
 * no credit card, 350 requests/day, up to 100K characters per request.
 *
 * Switched from ElevenLabs because ElevenLabs blocks ALL voices (library
 * AND custom clones) from free-tier API access as of their current terms
 * — that's a platform-wide restriction, not something fixable by picking
 * a different voice. VoiceRSS has no such restriction on its free tier.
 */
export async function generateVoiceover(text: string, outDir: string): Promise<string> {
  const apiKey = process.env.VOICERSS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOICERSS_API_KEY is not set. Get a free key at voicerss.org/registration.aspx — see .env.example."
    );
  }

  const params = new URLSearchParams({
    key: apiKey,
    src: text,
    hl: "en-us",
    v: "Mary", // clear default US English voice; see voicerss.org for other free voices
    c: "MP3",
    f: "44khz_16bit_stereo",
  });

  const response = await fetch(`https://api.voicerss.org/?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`VoiceRSS TTS failed: ${response.status} ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // VoiceRSS returns HTTP 200 even on errors (e.g. bad key, quota hit) —
  // it puts the error message in the body starting with "ERROR". Check
  // for that explicitly since a failed request would otherwise silently
  // produce a tiny "audio" file containing an error string.
  const preview = Buffer.from(arrayBuffer.slice(0, 200)).toString("utf-8");
  if (preview.startsWith("ERROR")) {
    throw new Error(`VoiceRSS TTS failed: ${preview}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "voiceover.mp3");
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  return outPath;
}
