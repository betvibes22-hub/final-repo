import fs from "fs";

/**
 * Transcribes an audio file via Groq's free-tier Whisper endpoint —
 * same GROQ_API_KEY already used for script writing, no new service or
 * key needed. Genuinely free (console.groq.com), no card required.
 *
 * Free tier caps uploads at 25MB per file — this app compresses to a
 * mono, low-bitrate MP3 before calling this (see extractCompressedAudio
 * in the remix route), which keeps all but very long uploads well under
 * that limit without needing to chunk the file.
 */
export async function transcribeAudioGroq(audioPath: string, apiKey: string): Promise<string> {
  const stats = fs.statSync(audioPath);
  if (stats.size > 25 * 1024 * 1024) {
    throw new Error(
      "That video's audio track is too long for a single free transcription request (25MB limit). Try a shorter clip."
    );
  }

  const buffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), "audio.mp3");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "text");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
  }

  const text = (await res.text()).trim();
  if (!text) {
    throw new Error("Transcription came back empty — the video may not have clear speech in it.");
  }
  return text;
}
