import type { CSSProperties } from "react";

// Shared between the main generate page and the Remix page — both drive
// the same job lifecycle (script approval -> voice approval -> visuals
// -> compose -> upload) and need identical status/approval UI. Splitting
// this out is also the fix for a real bug: the approval card used to
// live only in the main page's JSX, positioned above the Remix section,
// so a job created via Remix would genuinely pause waiting for a script/
// voice approval click, but the button to do that rendered off-screen,
// above where the Remix uploader is. Giving Remix its own page with its
// own copy of this same UI (right next to its own upload button) fixes
// that — the approval controls are now always visible next to whatever
// action created the job.

export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";
export type ScriptMode = "ai" | "custom" | "hybrid";

export interface SceneInfo {
  text: string;
}
export interface ScriptInfo {
  title: string;
  scenes: SceneInfo[];
}

export interface ActivityLogEntry {
  ts: number;
  text: string;
  service: "groq" | "tavily" | "elevenlabs" | "piper" | "voicerss" | "pixabay" | "pexels" | "pollinations" | "ffmpeg" | "cloudinary";
}

export interface JobState {
  id: string;
  status: string;
  awaitingStage?: string;
  progressNote?: string;
  outputVideoPath?: string;
  voiceoverPreviewUrl?: string;
  script?: ScriptInfo;
  error?: string;
  request?: { scriptMode?: ScriptMode };
  activityLog?: ActivityLogEntry[];
  metaTitle?: string;
  metaDescription?: string;
  metaTags?: string[];
  thumbnailUrl?: string;
}

// ElevenLabs premade voice catalog — same voices used by Pictory, InVideo,
// Opus Clip and every top AI video platform. Keys are ElevenLabs voice IDs.
// When ELEVENLABS_API_KEY is set these are the active voices; otherwise Piper
// voices are used as fallback (see lib/providers/tts.ts).
export const VOICES_BY_GENDER: Record<VoiceGender, { key: string; name: string }[]> = {
  female: [
    { key: "hpp4J3VqNfWAUOO0d1Us", name: "Bella" },
    { key: "FGY2WhTYpPnrIDTdsKH5", name: "Laura" },
    { key: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice (British)" },
    { key: "XrExE9yKIg1WjnnlVkGX", name: "Matilda" },
    { key: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (British)" },
  ],
  male: [
    { key: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam" },
    { key: "nPczCjzI2devNBz1zQrb", name: "Brian" },
    { key: "JBFqnCBsd6RMkjVDRZzb", name: "George (British)" },
    { key: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (British)" },
    { key: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  ],
};

export const STATUS_LABELS: Record<string, string> = {
  queued: "In the queue",
  writing_script: "Writing script",
  awaiting_approval: "Waiting on you",
  generating_voiceover: "Recording voiceover",
  generating_visuals: "Selecting footage",
  composing: "Editing final cut",
  uploading: "Saving your video",
  done: "It's a wrap",
  failed: "Cut! Something went wrong",
};

export const TIMELINE_STEPS = [
  { key: "writing_script", label: "Writing script" },
  { key: "script_review", label: "Script review" },
  { key: "generating_voiceover", label: "Recording voiceover" },
  { key: "voice_review", label: "Voice review" },
  { key: "generating_visuals", label: "Selecting footage" },
  { key: "composing", label: "Editing final cut" },
  { key: "uploading", label: "Saving video" },
  { key: "done", label: "Done" },
];

export const SERVICE_META: Record<ActivityLogEntry["service"], { label: string; color: string }> = {
  groq: { label: "Groq (script)", color: "#d4af37" },
  tavily: { label: "Tavily (trends)", color: "#8ab4f8" },
  elevenlabs: { label: "ElevenLabs (voice)", color: "#a78bfa" },
  piper: { label: "Piper (voice fallback)", color: "#c792ea" },
  voicerss: { label: "VoiceRSS (voice fallback)", color: "#c792ea" },
  pixabay: { label: "Pixabay (footage)", color: "#7ec699" },
  pexels: { label: "Pexels (footage fallback)", color: "#7ec699" },
  pollinations: { label: "Pollinations (AI illustrations)", color: "#e07af2" },
  ffmpeg: { label: "FFmpeg (editing)", color: "#f2994a" },
  cloudinary: { label: "Cloudinary (storage)", color: "#56ccf2" },
};

export const ALL_SERVICES: ActivityLogEntry["service"][] = [
  "groq",
  "tavily",
  "elevenlabs",
  "piper",
  "voicerss",
  "pixabay",
  "pexels",
  "pollinations",
  "ffmpeg",
  "cloudinary",
];

export function currentTimelineKey(job: JobState | null): string | null {
  if (!job) return null;
  if (job.status === "awaiting_approval") {
    return job.awaitingStage === "script" ? "script_review" : "voice_review";
  }
  return job.status;
}

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: 12,
  fontSize: 16,
  marginBottom: 20,
  boxSizing: "border-box",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontFamily: "inherit",
};

export const labelStyle: CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600, color: "#f2eee3" };

export const approveBtnStyle: CSSProperties = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "#d4af37",
  color: "#111",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 12,
};

export const disapproveBtnStyle: CSSProperties = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "transparent",
  color: "#d4af37",
  border: "1px solid #d4af37",
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 12,
  marginLeft: 10,
};

/** Fetches a one-off status snapshot; used by startPolling() in each page. */
export async function fetchJobStatus(jobId: string): Promise<JobState> {
  const res = await fetch(`/api/status?jobId=${jobId}`);
  return res.json();
}

export async function approveStage(
  jobId: string,
  stage: string,
  decision: "approve" | "regenerate",
  voice: { voiceGender: VoiceGender; voiceName: string; voicePace: VoicePace }
): Promise<void> {
  await fetch("/api/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, stage, decision, ...voice }),
  });
}
