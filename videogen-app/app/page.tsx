"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import JobStatusCard from "./components/JobStatusCard";
import ActivitySidebar from "./components/ActivitySidebar";
import {
  JobState,
  VoiceGender,
  VoicePace,
  VOICES_BY_GENDER,
  inputStyle,
  labelStyle,
  fetchJobStatus,
  approveStage as approveStageApi,
} from "./lib/jobUiShared";

interface LibraryVideo {
  url: string;
  title: string;
  createdAt: string;
}

export default function Home() {
  const [conceptA, setConceptA] = useState("");
  const [conceptB, setConceptB] = useState("");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [voiceName, setVoiceName] = useState(VOICES_BY_GENDER["female"][0].key);
  const [voicePace, setVoicePace] = useState<VoicePace>("normal");
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      setLibrary(data.videos ?? []);
    } catch {}
    setLibraryLoading(false);
  }

  const canSubmit = conceptA.trim().length > 0 && conceptB.trim().length > 0;
  const busy = submitting || (job !== null && job.status !== "done" && job.status !== "failed");

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

  async function handleGenerate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setJob(null);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // topic is required by the API — use A vs B as fallback label
        topic: `${conceptA} vs ${conceptB}`,
        style: "stickman",
        targetLengthSeconds: 45,
        scriptMode: "comparison",
        conceptA,
        conceptB,
        voiceGender,
        voiceName,
        voicePace,
        aspectRatio: "9:16",
      }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (data.error) {
      setJob({ id: "", status: "failed", error: data.error });
      return;
    }

    setJob({ id: data.jobId, status: "queued" });
    startPolling(data.jobId);
  }

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const data = await fetchJobStatus(jobId);
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.status === "done") loadLibrary();
      }
    }, 2000);
  }

  async function handleApprove(stage: string, decision: "approve" | "regenerate" = "approve") {
    if (!job) return;
    setApproving(true);
    await approveStageApi(job.id, stage, decision, { voiceGender, voiceName, voicePace });
    setApproving(false);
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

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "sans-serif",
      }}
    >
      {/* HEADER */}
      <div style={{ marginBottom: 40, textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            marginBottom: 18,
            borderRadius: 999,
            border: "1px solid rgba(212,175,55,0.5)",
            background: "rgba(212,175,55,0.08)",
            fontSize: 12,
            fontWeight: 700,
            color: "#d4af37",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {'🎬'} YouTube Shorts Generator
        </div>
        <h1
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: "#f2eee3",
            margin: "0 0 10px",
            lineHeight: 1.15,
          }}
        >
          What&apos;s the Difference?
        </h1>
        <p style={{ color: "#b8b2a0", fontSize: 16, maxWidth: 520, margin: "0 auto" }}>
          Type two concepts. Get a viral Short explaining the difference — stickman style, 9:16, ready to upload.
        </p>
      </div>

      <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
        {/* MAIN COLUMN */}
        <main style={{ flex: "2 1 480px", minWidth: 320 }}>
          {/* A vs B INPUTS */}
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Concept A</label>
              <input
                type="text"
                value={conceptA}
                onChange={(e) => setConceptA(e.target.value)}
                placeholder="e.g. JPEG"
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
            </div>

            <div
              style={{
                flexShrink: 0,
                marginTop: 24,
                fontSize: 28,
                fontWeight: 800,
                color: "#d4af37",
                lineHeight: 1,
              }}
            >
              vs
            </div>

            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Concept B</label>
              <input
                type="text"
                value={conceptB}
                onChange={(e) => setConceptB(e.target.value)}
                placeholder="e.g. PNG"
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
            </div>
          </div>

          {/* LOCKED FORMAT BADGE */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            {[
              { icon: "🖊️", label: "Stickman" },
              { icon: "📱", label: "9:16 Shorts" },
              { icon: "⚡", label: "~45 seconds" },
              { icon: "🎯", label: "5-scene script" },
            ].map((badge) => (
              <div
                key={badge.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "rgba(212,175,55,0.08)",
                  border: "1px solid rgba(212,175,55,0.2)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#c9a830",
                }}
              >
                <span>{badge.icon}</span>
                <span>{badge.label}</span>
              </div>
            ))}
          </div>

          {/* VOICE PICKER */}
          <label style={labelStyle}>Voice</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
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
            <select
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            >
              {VOICES_BY_GENDER[voiceGender].map((v) => (
                <option key={v.key} value={v.key}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              value={voicePace}
              onChange={(e) => setVoicePace(e.target.value as VoicePace)}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            >
              <option value="slower">Slower</option>
              <option value="normal">Normal pace</option>
              <option value="faster">Faster</option>
            </select>
          </div>
          <button
            onClick={handlePreviewVoice}
            disabled={previewingVoice}
            style={{
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "transparent",
              color: "#d4af37",
              border: "1px solid rgba(212,175,55,0.5)",
              borderRadius: 6,
              cursor: previewingVoice ? "default" : "pointer",
              marginBottom: 28,
              opacity: previewingVoice ? 0.6 : 1,
            }}
          >
            {previewingVoice ? "Loading..." : "▶ Preview voice"}
          </button>
          {voicePreviewError && (
            <p style={{ color: "#e08a8a", fontSize: 12, marginTop: -22, marginBottom: 20 }}>
              {voicePreviewError}
            </p>
          )}

          {/* GENERATE BUTTON */}
          <button
            onClick={handleGenerate}
            disabled={!!busy || !canSubmit}
            style={{
              width: "100%",
              padding: "16px 20px",
              fontSize: 17,
              fontWeight: 700,
              background: canSubmit && !busy ? "#d4af37" : "rgba(212,175,55,0.15)",
              color: canSubmit && !busy ? "#0b0a08" : "#6b6656",
              border: "1px solid #d4af37",
              borderRadius: 10,
              cursor: busy || !canSubmit ? "default" : "pointer",
              transition: "all 0.15s",
              letterSpacing: 0.3,
            }}
          >
            {submitting
              ? "Writing script..."
              : busy
              ? "Generating..."
              : conceptA && conceptB
              ? `Generate "${conceptA} vs ${conceptB}"`
              : "Generate Short"}
          </button>

          {/* JOB STATUS */}
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

          {/* EXAMPLES */}
          <div style={{ marginTop: 32 }}>
            <p style={{ fontSize: 12, color: "#6b6656", marginBottom: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
              Try these
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.a + ex.b}
                  onClick={() => {
                    setConceptA(ex.a);
                    setConceptB(ex.b);
                  }}
                  style={{
                    padding: "7px 13px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "transparent",
                    color: "#9d9784",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  {ex.a} vs {ex.b}
                </button>
              ))}
            </div>
          </div>

          {/* PAST VIDEOS */}
          <div style={{ marginTop: 52 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16, color: "#f2eee3" }}>Past videos</h2>
            {libraryLoading && <p style={{ color: "#666" }}>Loading...</p>}
            {!libraryLoading && library.length === 0 && (
              <p style={{ color: "#666", fontSize: 13 }}>
                Nothing yet — your finished Shorts will show up here.
              </p>
            )}
            {library.map((v, i) => (
              <div key={i} style={{ marginBottom: 28 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <p style={{ fontWeight: 600, margin: 0, color: "#f2eee3", fontSize: 14 }}>{v.title}</p>
                  <a href={v.url} download style={{ fontSize: 13, color: "#d4af37", textDecoration: "none" }}>
                    ↓ Download
                  </a>
                </div>
                <video controls style={{ width: "100%", borderRadius: 8, maxHeight: 480 }}>
                  <source src={v.url} type="video/mp4" />
                </video>
              </div>
            ))}
          </div>

          {/* OTHER TOOLS */}
          <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                padding: "18px 22px",
                borderRadius: 10,
                border: "1px solid rgba(212,175,55,0.2)",
                background: "rgba(212,175,55,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p style={{ fontWeight: 700, color: "#f2eee3", margin: "0 0 3px", fontSize: 14 }}>
                  {'🎭'} Short Drama Generator
                </p>
                <p style={{ color: "#9d9784", fontSize: 13, margin: 0 }}>
                  Premise + two characters → 5-scene animated drama Short.
                </p>
              </div>
              <Link
                href="/drama"
                style={{
                  flexShrink: 0,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#d4af37",
                  border: "1px solid #d4af37",
                  borderRadius: 8,
                  textDecoration: "none",
                }}
              >
                Make a drama →
              </Link>
            </div>

            <div
              style={{
                padding: "18px 22px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p style={{ fontWeight: 700, color: "#f2eee3", margin: "0 0 3px", fontSize: 14 }}>
                  🔁 Remix a video
                </p>
                <p style={{ color: "#9d9784", fontSize: 13, margin: 0 }}>
                  Upload any video and get an original one inspired by its structure.
                </p>
              </div>
              <Link
                href="/remix"
                style={{
                  flexShrink: 0,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#9d9784",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  textDecoration: "none",
                }}
              >
                Remix →
              </Link>
            </div>
          </div>
        </main>

        {/* SIDEBAR */}
        <ActivitySidebar job={job} />
      </div>

      {/* FOOTER */}
      <footer
        style={{
          marginTop: 64,
          paddingTop: 28,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 18,
        }}
      >
        {POWERED_BY.map((item) => (
          <div key={item.name}>
            <p style={{ fontWeight: 600, margin: "0 0 3px", color: "#d4af37", fontSize: 13 }}>{item.name}</p>
            <p style={{ fontSize: 12, color: "#8a8474", margin: 0, lineHeight: 1.5 }}>{item.does}</p>
          </div>
        ))}
      </footer>
    </div>
  );
}

const EXAMPLES = [
  { a: "JPEG", b: "PNG" },
  { a: "TCP", b: "UDP" },
  { a: "RAM", b: "ROM" },
  { a: "Latte", b: "Cappuccino" },
  { a: "Stocks", b: "Bonds" },
  { a: "Machine Learning", b: "Deep Learning" },
  { a: "Affect", b: "Effect" },
  { a: "Visa", b: "Mastercard" },
];

const POWERED_BY = [
  { name: "Groq", does: "Writes the script fast using the openai/gpt-oss-120b model." },
  { name: "Piper TTS", does: "Self-hosted open-source text-to-speech — 20 real voices, no API cap." },
  { name: "Pollinations", does: "Free AI image generation for stickman visuals — no key needed." },
  { name: "FFmpeg", does: "Assembles scenes, captions, and timing into the final MP4." },
  { name: "Cloudinary", does: "Hosts every finished Short and powers the past-videos library." },
  { name: "Tavily", does: "Optional — pulls current search trends into scripts when connected." },
];
