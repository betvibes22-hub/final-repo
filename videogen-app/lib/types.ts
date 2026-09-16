export type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";
export type ScriptMode = "ai" | "custom" | "hybrid";
export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";

export interface GenerateRequest {
  topic: string;
  style: VideoStyle;
  targetLengthSeconds: number;
  scriptMode?: ScriptMode;
  customScript?: string;
  voiceGender?: VoiceGender;
  voiceName?: string;
  voicePace?: VoicePace;
}

export interface Scene {
  index: number;
  text: string;
  startSeconds: number;
  durationSeconds: number;
  visualPrompt: string;
  visualAssetPaths?: string[];
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
}
