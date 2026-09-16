import fs from "fs";
import path from "path";

/**
 * Generates a voiceover MP3 from text using ElevenLabs.
 * Returns the local file path where the MP3 was saved.
 */
export async function generateVoiceover(text: string, outDir: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    throw new Error(
      "ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID missing. See .env.example."
    );
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "voiceover.mp3");
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  return outPath;
}
