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

type Genre = "romance" | "thriller" | "horror" | "fantasy" | "comedy" | "action";

const GENRE_META: Record<Genre, { emoji: string; label: string; hint: string }> = {
  romance: { emoji: "💕", label: "Romance", hint: "Love, tension, longing" },
  thriller: { emoji: "🔪", label: "Thriller", hint: "Suspense, danger, secrets" },
  horror: { emoji: "👻", label: "Horror", hint: "Fear, dread, the unknown" },
  fantasy: { emoji: "🧙", label: "Fantasy", hint: "Magic, worlds, destiny" },
  comedy: { emoji: "😂", label: "Comedy", hint: "Chaos, timing, absurdity" },
  action: { emoji: "💥", label: "Action", hint: "Stakes, speed, power" },
};

const PREMISE_EXAMPLES: Record<Genre, { premise: string; a: string; b: string }[]> = {
  romance: [
    { premise: "Two rival chefs are forced to share a kitchen for one night", a: "Maya", b: "Jake" },
    { premise: "She's returning the wrong lost dog — to the man she ghosted", a: "Lily", b: "Ethan" },
  ],
  thriller: [
    { premise: "A woman realizes the stranger on her flight knows things only her husband would", a: "Sara", b: "The Stranger" },
    { premise: "He finds a note in his pocket that he didn't write — it's a warning about tomorrow", a: "Marcus", b: "Unknown" },
  ],
  horror: [
    { premise: "Every night at 3am she hears her own voice calling from outside", a: "Nina", b: "The Voice" },
    { premise: "He agreed to housesit. The owners never said the mirrors don't work properly", a: "Daniel", b: "The Reflection" },
  ],
  fantasy: [
    { premise: "A girl discovers her new roommate ages backwards — and today she's a child", a: "Zoe", b: "Mira" },
    { premise: "He's a dragon disguised as a city bus driver", a: "Leo", b: "The Dragon" },
  ],
  comedy: [
    { premise: "She accidentally texted her boss a love note meant for her cat", a: "Priya", b: "Mr. Chen" },
    { premise: "He trained for a marathon but entered the wrong race — it's a dog show", a: "Tom", b: "Champion" },
  ],
  action: [
    { premise: "A delivery driver realizes the package she's carrying is what everyone in the city is hunting for", a: "Alex", b: "The Client" },
    { premise: "He has 60 seconds to defuse a bomb using only the items in his lunch box", a: "Ray", b: "The Caller" },
  ],
};

/**
 * Short Drama Generator — Toonflow-inspired animated short drama format.
 * Uses our free stack (Groq + Pollinations + Piper + FFmpeg + Cloudinary)
 * with a drama-specific 5-scene script structure:
 *   Setup → Inciting Incident → Rising Tension → Twist → Cliffhanger/Close
 */
export default function DramaPage() {
  const [genre, setGenre] = useState<Genre>("romance");
  const [premise, setPremise] = useState("");
  const [characterA, setCharacterA] = useState("");
  const [characterB, setCharacterB] = useState("");
  const [style, setStyle] = useState<"cartoon" | "stickman">("cartoon");
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

  const canSubmit = premise.trim().length > 0;
  const busy = submitting || (job !== null && job.status !== "done" && job.status !== "failed");

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
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: premise.trim(),
          style,
          targetLengthSeconds: 50,
          scriptMode: "drama",
          storyPremise: premise.trim(),
          characterA: characterA.trim() || undefined,
          characterB: characterB.trim() || undefined,
          genre,
          voiceGender,
          voiceName,
          voicePace,
          aspectRatio: "9:16",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to start generation.");
      setJob({ id: data.jobId, status: "queued" });
      startPolling(data.jobId);
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
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Voice preview failed.");
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
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't redo that scene.");
      }
      startPolling(job.id);
    } catch (err) {
      setJob({ ...job, error: err instanceof Error ? err.message : String(err) });
    }
    setRegeneratingScene(null);
  }

  function fillExample(ex: { premise: string; a: string; b: string }) {
    setPremise(ex.premise);
    setCharacterA(ex.a);
    setCharacterB(ex.b);
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <Link href="/" style={{ color: "#d4af37", fontSize: 13, textDecoration: "none" }}>
        ← Back to What&apos;s the Difference?
      </Link>

      {/* HEADER */}
      <div style={{ textAlign: "center", margin: "20px 0 40px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            marginBottom: 16,
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
          {'🎭'} Short Drama Generator
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 800, color: "#f2eee3", margin: "0 0 10px", lineHeight: 1.15 }}>
          Turn any story into a Short
        </h1>
        <p style={{ color: "#b8b2a0", fontSize: 15, maxWidth: 540, margin: "0 auto" }}>
          One-line premise. Two characters. Animated in 5 scenes — Toonflow-style drama on our free stack.
        </p>
      </div>

      <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
        <main style={{ flex: "2 1 480px", minWidth: 320 }}>

          {/* GENRE PICKER */}
          <label style={labelStyle}>Genre</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {(Object.entries(GENRE_META) as [Genre, typeof GENRE_META[Genre]][]).map(([g, meta]) => (
              <button
                key={g}
                onClick={() => setGenre(g)}
                style={{
                  flex: "1 1 calc(33% - 8px)",
                  minWidth: 100,
                  padding: "10px 8px",
                  borderRadius: 8,
                  border: genre === g ? "2px solid #d4af37" : "1px solid rgba(212,175,55,0.25)",
                  background: genre === g ? "rgba(212,175,55,0.1)" : "transparent",
                  color: genre === g ? "#d4af37" : "#9d9784",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{meta.label}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{meta.hint}</span>
              </button>
            ))}
          </div>

          {/* PREMISE */}
          <label style={labelStyle}>Story premise</label>
          <textarea
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder={`e.g. ${PREMISE_EXAMPLES[genre][0].premise}`}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />

          {/* EXAMPLE CHIPS */}
          <p style={{ fontSize: 11, color: "#6b6656", marginBottom: 8, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Try these {GENRE_META[genre].label.toLowerCase()} premises
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
            {PREMISE_EXAMPLES[genre].map((ex, i) => (
              <button
                key={i}
                onClick={() => fillExample(ex)}
                style={{
                  textAlign: "left",
                  padding: "9px 14px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: "#9d9784",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                &ldquo;{ex.premise}&rdquo; <span style={{ color: "#6b6656" }}>— {ex.a} &amp; {ex.b}</span>
              </button>
            ))}
          </div>

          {/* CHARACTER NAMES */}
          <label style={labelStyle}>Characters (optional — helps visual consistency)</label>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <input
              type="text"
              value={characterA}
              onChange={(e) => setCharacterA(e.target.value)}
              placeholder="Character A name"
              style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
            />
            <input
              type="text"
              value={characterB}
              onChange={(e) => setCharacterB(e.target.value)}
              placeholder="Character B name"
              style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
            />
          </div>

          {/* STYLE */}
          <label style={labelStyle}>Visual style</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            {(["cartoon", "stickman"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                style={{
                  flex: 1,
                  padding: "12px 10px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: style === s ? "2px solid #d4af37" : "1px solid rgba(212,175,55,0.3)",
                  background: style === s ? "rgba(212,175,55,0.12)" : "transparent",
                  color: style === s ? "#d4af37" : "#9d9784",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {s === "cartoon" ? "🎨 Cartoon" : "🖊️ Stickman"}
              </button>
            ))}
          </div>

          {/* FORMAT BADGES */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            {[
              { icon: "📱", label: "9:16 Shorts" },
              { icon: "🎬", label: "5-scene drama" },
              { icon: "⏱️", label: "~50 seconds" },
            ].map((b) => (
              <div
                key={b.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 11px",
                  borderRadius: 999,
                  background: "rgba(212,175,55,0.07)",
                  border: "1px solid rgba(212,175,55,0.2)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#c9a830",
                }}
              >
                <span>{b.icon}</span><span>{b.label}</span>
              </div>
            ))}
          </div>

          {/* VOICE */}
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
              marginBottom: 24,
              opacity: previewingVoice ? 0.6 : 1,
            }}
          >
            {previewingVoice ? "Loading..." : "▶ Preview voice"}
          </button>
          {voicePreviewError && (
            <p style={{ color: "#e08a8a", fontSize: 12, marginTop: -20, marginBottom: 16 }}>{voicePreviewError}</p>
          )}

          {/* GENERATE */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
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
              letterSpacing: 0.3,
            }}
          >
            {submitting
              ? "Writing your drama..."
              : busy
              ? "Generating..."
              : `Generate ${GENRE_META[genre].emoji} Short Drama`}
          </button>
          {submitError && (
            <p style={{ color: "#e08a8a", fontSize: 13, marginTop: 10 }}>{submitError}</p>
          )}

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
