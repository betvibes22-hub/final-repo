/**
 * Voiceover generation — public API for the pipeline.
 *
 * Priority:
 *   1. ElevenLabs (ELEVENLABS_API_KEY set) — industry-standard TTS used by
 *      Pictory, InVideo, Opus Clip and every major AI video platform.
 *      Natural, expressive, broadcast-quality.
 *   2. Piper (self-hosted, always available) — unlimited, no key required,
 *      decent quality. Activated when ElevenLabs is unavailable or fails.
 *
 * VoiceRSS was the previous fallback; removed because its 5-voice free
 * tier adds nothing that Piper (23 voices, unlimited) doesn't already cover.
 */

import {
  VoiceGender,
  VoicePace,
  VoiceOptions,
  generateVoiceoverPiper,
  listAvailableVoices as listPiperVoices,
} from "./piperTts";
import {
  generateVoiceoverElevenLabs,
  isElevenLabsAvailable,
  ELEVENLABS_VOICES,
} from "./elevenLabsTts";

export type { VoiceGender, VoicePace, VoiceOptions } from "./piperTts";

/**
 * Returns the active voice catalog — ElevenLabs voices when the API key
 * is present, otherwise Piper's 23-voice catalog.
 */
export function listAvailableVoices(): { key: string; name: string; gender: VoiceGender }[] {
  if (isElevenLabsAvailable()) {
    return ELEVENLABS_VOICES.map((v) => ({
      key: v.voiceId,
      name: v.displayName,
      gender: v.gender,
    }));
  }
  return listPiperVoices();
}

export async function generateVoiceover(
  text: string,
  outDir: string,
  options: VoiceOptions = {},
  onLog?: (text: string, service: "elevenlabs" | "piper" | "voicerss") => void
): Promise<string> {
  if (isElevenLabsAvailable()) {
    try {
      return await generateVoiceoverElevenLabs(
        text,
        outDir,
        options,
        (t) => onLog?.(t, "elevenlabs")
      );
    } catch (err) {
      console.error("ElevenLabs TTS failed, falling back to Piper:", err);
      onLog?.(
        `ElevenLabs failed (${(err as Error).message}), falling back to Piper…`,
        "elevenlabs"
      );
    }
  }

  // Piper fallback — always available, no network dependency
  return generateVoiceoverPiper(
    text,
    outDir,
    options,
    (t) => onLog?.(t, "piper")
  );
}
