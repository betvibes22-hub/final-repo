"use client";

import {
  JobState,
  VoiceGender,
  VoicePace,
  VOICES_BY_GENDER,
  STATUS_LABELS,
  inputStyle,
  approveBtnStyle,
  disapproveBtnStyle,
} from "../lib/jobUiShared";

interface Props {
  job: JobState;
  approving: boolean;
  onApprove: (stage: string, decision: "approve" | "regenerate") => void;
  voiceGender: VoiceGender;
  setVoiceGender: (g: VoiceGender) => void;
  voiceName: string;
  setVoiceName: (n: string) => void;
  voicePace: VoicePace;
  setVoicePace: (p: VoicePace) => void;
  previewingVoice: boolean;
  onPreviewVoice: () => void;
  voicePreviewError: string | null;
  regeneratingScene: number | null;
  onRegenerateScene: (sceneIndex: number) => void;
}

/**
 * The status/approval/results card — shared by the main generate page
 * and the Remix page so both show the SAME real-time state, including
 * the script/voice approval checkpoints. This used to exist only in the
 * main page's JSX, positioned above the Remix section; a job created
 * via Remix would genuinely pause waiting for approval, but the button
 * to approve it rendered somewhere the Remix user had already scrolled
 * past, so it looked like Remix "did nothing." Giving each page its own
 * copy of this component right next to its own
