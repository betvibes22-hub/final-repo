export type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";

export type ScriptMode = "ai" | "custom" | "hybrid";

export interface GenerateRequest {
  topic: string;
  style: VideoStyle;
  targetLengthSeconds: number; // e.g. 60, 180, 300
  scriptMode?: ScriptMode;     // "ai" (default), "custom", or "hybrid"
  customScript?: string;       // user-provided script text (custom/hybrid modes)
}

export interface Scene {
  index: number;
  text: string;          // the narration line(s) for this scene
  startSeconds: number;  // where this scene starts in the final timeline
  durationSeconds: number;
  visualPrompt: string;  // what to generate visually for this scene
  visualAssetPaths?: string[]; // multiple images per scene, filled in once generated
}

export interface Script {
  title: string;
  scenes: Scene[];
  fullNarrationText: string;
}

export type JobStatus =
  | "queued"
  | "writing_script"
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
  outputVideoPath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  progressNote?: string; // human-readable "what's happening right now"
}
