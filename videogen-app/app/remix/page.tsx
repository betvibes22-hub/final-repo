"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import JobStatusCard from "../components/JobStatusCard";
import ActivitySidebar from "../components/ActivitySidebar";
import {
  JobState,
  VoiceGender,
  VoicePace,
  VOICES_BY_GENDER,
  inputStyle,
  labelStyle,
  fetchJobStatus,
  approveStage as approveStageApi,
} from "../lib/jobUiShared";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "stickman" | "realistic";
type StyleVariant = "default" | "ghibli" | "watercolor" | "crayon" | "sketchy" | "vivid" | "cinematic";
type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype" | "viral-explainer" | "topx" | "sleep";

/**
 * Remix gets its own page (previously it was a section at the bottom of
 * the main generate page, reached by scrolling). That placement caused
 * a real bug, not just an inconvenience: the script/voice approval
 * card lived in the main page's JSX ABOVE the Remix section, so a job
 * created via Remix would genuinely pause mid-pipeline waiting for an
 * approval click, but the button for that click rendered somewhere the
 * user had already scrolled past — it looked like Remix "did nothing."
 * This page has its own copy of the same status/approval UI right next
 * to its own upload button, so that can't happen here.
 */
export default function RemixPage() {
  const [remixFile, setRemixFile] = useState<File | null>(null);
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
  const [styleVariant, setStyleVariant] = useState<StyleVariant>("default");
  const [vibe, setVibe] = useState<ScriptVibe>("documentary");
  const [lengthSeconds, setLengthSeconds] = useState(60);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [voiceName, setVoiceName] = useState("en_US-amy-medium");
  const [voicePace, setVoicePace] = useState<VoicePace>("normal");

  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const data = await fetchJobStatus(jobId);
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
  }

  async function handleSubmit() {
    if (!remixFile) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append("video", remixFile);
      form.append("style", style);
      form.append("styleVariant", styleVariant);
      form.append("vibe", vibe);
      form.append("targetLengthSeconds", String(lengthSeconds));
      form.append("voiceGender", voiceGender);
      form.append("voiceName", voiceName);
      form.append("voicePace", voicePace);

      const res = await fetch("/api/remix-upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Couldn't process that video.");
      }
      setJob({ id: data.jobId, status: "queued" });
      startPolling(data.jobId);
      setRemixFile(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
    setSubmitting(false);
  }

  async function handleApprove(stage: string, decision: "approve" | "regenerate") {
    if (!job) return;
    setApproving(true);
    await approveStageApi(job.id, stage, decision, { voiceGender, voiceName, voicePace });
    setApproving(false);
  }

  async function handlePreviewVoice() {
    setPreviewingVoice(true);
    setVoicePreviewError(null);
    try {
      const res = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceGender, voiceName, voicePace }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Voice preview failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (voicePreviewAudioRef.current) voicePreviewAudioRef.current.pause();
      const audio = new Audio(url);
      voicePreviewAudioRef.current = audio;
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      setVoicePreviewError(err instanceof Error ? err.message : String(err));
    }
    setPreviewingVoice(false);
  }

  async function handleRegenerateScene(sceneIndex: number) {
    if (!job) return;
    setRegeneratingScene(sceneIndex);
    try {
      const res = await fetch("/api/regenerate-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, sceneIndex }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't redo that scene.");
      }
      startPolling(job.id);
    } catch (err) {
      setJob({ ...job, error: err instanceof Error ? err.message : String(err) });
    }
    setRegeneratingScene(null);
  }

  const busy = submitting || (job !== null && job.status !== "done" && job.status !== "failed");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <Link href="/" style={{ color: "#d4af37", fontSize: 13, textDecoration: "none" }}>
        ← Back to generate
      </Link>
      <h1 style={{ fontSize: 28, margin: "12px 0 6px", color: "#f2eee3" }}>Remix a video</h1>
      <p style={{ color: "#b8b2a0", fontSize: 14, marginBottom: 32, maxWidth: 640 }}>
        Upload a video and this makes an original one inspired by its topic and structure — its own script written
        from scratch, not a copy. Works best under a few minutes long.
      </p>

      <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
        <main style={{ flex: "2 1 480px", minWidth: 320 }}>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setRemixFile(e.target.files?.[0] ?? null)}
            style={{ color: "#cfc9ba", fontSize: 13, marginBottom: 20, display: "block" }}
          />

          <label style={labelStyle}>Style</label>
          <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} style={inputStyle}>
            <option value="whiteboard-doodle">Whiteboard / Doodle</option>
            <option value="stickman">Stickman Explainer</option>
            <option value="cartoon">Cartoon</option>
            <option value="realistic">Realistic</option>
          </select>

          {style !== "realistic" && (
            <>
              <label style={labelStyle}>Look</label>
              <select value={styleVariant} onChange={(e) => setStyleVariant(e.target.value as StyleVariant)} style={inputStyle}>
                <option value="default">Default</option>
                <option value="ghibli">Ghibli-inspired</option>
                <option value="watercolor">Watercolor</option>
                <option value="crayon">Crayon</option>
                <option value="sketchy">Sketchy</option>
                <option value="vivid">Vivid</option>
                <option value="cinematic">Cinematic</option>
              </select>
            </>
          )}

          <label style={labelStyle}>Vibe</label>
          <select value={vibe} onChange={(e) => setVibe(e.target.value as ScriptVibe)} style={inputStyle}>
            <option value="documentary">Documentary / Explainer</option>
            <option value="fun-shorts">Fun Shorts</option>
            <option value="storytime">Storytime</option>
            <option value="hype">Hype / High-energy hook</option>
            <option value="topx">Top X / Countdown list</option>
            <option value="sleep">Sleep / Calm ambient</option>
            <option value="viral-explainer">Viral Explainer</option>
          </select>

          <label style={labelStyle}>Target length (seconds)</label>
          <input
            type="number"
            min={15}
            max={300}
            value={lengthSeconds}
            onChange={(e) => setLengthSeconds(Number(e.target.value))}
            style={inputStyle}
          />

          <label style={labelStyle}>Voice</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <select
              value={voiceGender}
              onChange={(e) => {
                const g = e.target.value as VoiceGender;
                setVoiceGender(g);
                setVoiceName(VOICES_BY_GENDER[g][0].key);
              }}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
            <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
              {VOICES_BY_GENDER[voiceGender].map((v) => (
                <option key={v.key} value={v.key}>{v.name}</option>
              ))}
            </select>
            <select value={voicePace} onChange={(e) => setVoicePace(e.target.value as VoicePace)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
              <option value="slower">Slower</option>
              <option value="normal">Normal pace</option>
              <option value="faster">Faster</option>
            </select>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!remixFile || busy}
            style={{
              padding: "12px 24px",
              fontSize: 15,
              fontWeight: 600,
              background: remixFile && !busy ? "#d4af37" : "transparent",
              color: remixFile && !busy ? "#0b0a08" : "#6b6656",
              border: "1px solid #d4af37",
              borderRadius: 8,
              cursor: !remixFile || busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {submitting ? "Uploading & transcribing..." : "Remix this video"}
          </button>
          {submitError && <p style={{ color: "#e08a8a", fontSize: 13, marginTop: 10 }}>{submitError}</p>}

          {job && (
            <JobStatusCard
              job={job}
              approving={approving}
              onApprove={handleApprove}
              voiceGender={voiceGender}
              setVoiceGender={setVoiceGender}
              voiceName={voiceName}
              setVoiceName={setVoiceName}
              voicePace={voicePace}
              setVoicePace={setVoicePace}
              previewingVoice={previewingVoice}
              onPreviewVoice={handlePreviewVoice}
              voicePreviewError={voicePreviewError}
              regeneratingScene={regeneratingScene}
              onRegenerateScene={handleRegenerateScene}
            />
          )}
        </main>

        <ActivitySidebar job={job} />
      </div>
    </div>
  );
}
