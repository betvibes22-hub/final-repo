export type VideoStyle = "cartoon" | "stickman";
export type ScriptMode = "ai" | "custom" | "hybrid" | "remix" | "comparison" | "drama";
export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";

export type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype" | "viral-explainer" | "topx" | "sleep";

export type StyleVariant = "default" | "ghibli" | "watercolor" | "crayon" | "sketchy" | "vivid" | "cinematic";

export type AspectRatio = "16:9" | "9:16";

export interface GenerateRequest {
  topic: string;
  style: VideoStyle;
  styleVariant?: StyleVariant;
  vibe?: ScriptVibe;
  targetLengthSeconds: number;
  scriptMode?: ScriptMode;
  customScript?: string;
  remixTranscript?: string;
  voiceGender?: VoiceGender;
  voiceName?: string;
  voicePace?: VoicePace;
  aspectRatio?: AspectRatio;
  conceptA?: string;
  conceptB?: string;
  storyPremise?: string;
  characterA?: string;
  characterB?: string;
  genre?: "romance" | "thriller" | "horror" | "fantasy" | "comedy" | "action";
}

export interface VisualAsset {
  path: string;
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
  service: "groq" | "tavily" | "piper" | "voicerss" | "pixabay" | "pexels" | "pollinations" | "ffmpeg" | "cloudinary";
}

export interface Job {
  id: string;
  status: JobStatus;
  request: GenerateRequest;
  script?: Script;
  voiceoverPath?: string;
  voiceoverPreviewUrl?: string;
  outputVideoPath?: string;
  awaitingStage?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  progressNote?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaTags?: string[];
  thumbnailUrl?: string;
  activityLog: ActivityLogEntry[];
}
