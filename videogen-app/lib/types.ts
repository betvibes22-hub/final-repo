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
  // Set alongside scriptMode "remix" — the transcript of a video the
  // user uploaded to remix. generateScriptGroq uses this as structural
  // inspiration only (topic, pacing, beat structure) and is explicitly
  // instructed not to reuse its actual wording — see script-groq.ts.
  remixTranscript?: string;
  voiceGender?: VoiceGender;
  voiceName?: string;
  voicePace?: VoicePace;
  // "16:9" = standard landscape (1920×1080, default)
  // "9:16" = vertical/Shorts (1080×1920 — drives FFmpeg output dims,
  //           Pollinations image orientation, and Pixabay portrait filter)
  aspectRatio?: AspectRatio;
  // "comparison" / "What's the Difference?" mode: A vs B
  conceptA?: string;
  conceptB?: string;
  // "drama" / Short Drama mode — story premise, two lead characters, genre
  storyPremise?: string;
  characterA?: string;
  characterB?: string;
  genre?: "romance" | "thriller" | "horror" | "fantasy" | "comedy" | "action";
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
  awaitingStage?: string; // "script" | "voice" — which checkpoint we're paused at
  error?: string;
  createdAt: number;
  updatedAt: number;
  progressNote?: string;
  // SEO metadata package — title/description/tags for publishing, plus
  // a generated thumbnail. Optional since it's produced after the
  // video itself, not required for the core pipeline to work.
  metaTitle?: string;
  metaDescription?: string;
  metaTags?: string[];
  thumbnailUrl?: string;
  // Granular, timestamped log of every real external-service call made
  // for this video — drives the detailed sidebar checklist.
  activityLog: ActivityLogEntry[];
}
