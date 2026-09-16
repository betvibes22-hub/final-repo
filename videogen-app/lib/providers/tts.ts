import fs from "fs";
import path from "path";

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
    v: "Mary",
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
