export type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";
export type ScriptMode = "ai" | "custom" | "hybrid";
export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";

export type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype";

export interface GenerateRequest {
  topic: string;
  style: VideoStyle;
  vibe?: ScriptVibe;
  targetLengthSeconds: number;
  scriptMode?: ScriptMode;
  customScript?: string;
  voiceGender?: VoiceGender;
  voiceName?: string;
  voicePace?: VoicePace;
}

export interface VisualAsset {
  path: string;
  // Lets compose.ts pick the right ffmpeg input handling — video clips
  // need to loop/trim as video, static images need the old -loop 1
  // image behavior. Falls back to "image" (Pexels photo, or a plain
  // placeholder) only when no real video match was found for a scene.
  type: "video" | "image";
}

export interface Scene {
  index: number;
  text: string;
  startSeconds: number;
  durationSeconds: number;
  visualPrompt: string;
  visualAssetPaths?: VisualAsset[];
}

export interface Script {
  title: string;
  scenes: Scene[];
  fullNarrationText: string;
}

export type JobStatus =
  | "queued"
  | "writing_script"
  | "awaiting_approval"
  | "generating_voiceover"
  | "generating_visuals"
  | "composing"
  | "uploading"
  | "done"
  | "failed";

export interface ActivityLogEntry {
  ts: number;
  text: string;
  // Which external service this line is about, so the frontend can
  // group/badge entries by service rather than just showing a flat list.
  service: "groq" | "tavily" | "piper" | "voicerss" | "pixabay" | "pexels" | "ffmpeg" | "cloudinary";
}

export interface Job {
  id: string;
  status: JobStatus;
  request: GenerateRequest;
  script?: Script;
  voiceoverPath?: string;
  voiceoverPreviewUrl?: string;
  outputVideoPath?: string;
  awaitingStage?: string; // "script" | "voice" — which checkpoint we're paused at
  error?: string;
  createdAt: number;
  updatedAt: number;
  progressNote?: string;
  // Granular, timestamped log of every real external-service call made
  // for this video — drives the detailed sidebar checklist.
  activityLog: ActivityLogEntry[];
}
