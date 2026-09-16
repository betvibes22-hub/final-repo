export type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";

export interface GenerateRequest {
  topic: string;
  style: VideoStyle;
  targetLengthSeconds: number; // e.g. 60, 180, 300
}

export interface Scene {
  index: number;
  text: string;          // the narration line(s) for this scene
  startSeconds: number;  // where this scene starts in the final timeline
  durationSeconds: number;
  visualPrompt: string;  // what to generate visually for this scene
  visualAssetPath?: string; // filled in once generated
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
