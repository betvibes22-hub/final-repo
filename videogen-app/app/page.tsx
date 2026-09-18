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

type VideoStyle = "whiteboard-doodle" | "cartoon" | "stickman" | "realistic";
type StyleVariant = "default" | "ghibli" | "watercolor" | "crayon" | "sketchy" | "vivid" | "cinematic";
type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype" | "viral-explainer" | "topx" | "sleep";
type ScriptMode = "ai" | "custom" | "hybrid";

interface LibraryVideo {
  url: string;
  title: string;
  createdAt: string;
}

const QUICK_START_PRESETS: {
  label: string;
  style: VideoStyle;
  styleVariant: StyleVariant;
  vibe: ScriptVibe;
  lengthSeconds: number;
}[] = [
  { label: "Sleep video", style: "cartoon", styleVariant: "watercolor", vibe: "sleep", lengthSeconds: 180 },
  { label: "Storytelling", style: "cartoon", styleVariant: "ghibli", vibe: "storytime", lengthSeconds: 90 },
  { label: "Stickman", style: "stickman", styleVariant: "default", vibe: "viral-explainer", lengthSeconds: 60 },
  { label: "Doodle Character", style: "whiteboard-doodle", styleVariant: "default", vibe: "documentary", lengthSeconds: 60 },
  { label: "Doodle Stickman", style: "stickman", styleVariant: "sketchy", vibe: "viral-explainer", lengthSeconds: 45 },
  { label: "Top X", style: "cartoon", styleVariant: "vivid", vibe: "topx", lengthSeconds: 60 },
];

export default function Home() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
  const [styleVariant, setStyleVariant] = useState<StyleVariant>("default");
  const [vibe, setVibe] = useState<ScriptVibe>("fun-shorts");
  const [lengthSeconds, setLengthSeconds] = useState(60);
  const [scriptMode, setScriptMode] = useState<ScriptMode>("ai");
  const [customScript, setCustomScript] = useState("");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [voiceName, setVoiceName] = useState("en_US-amy-medium");
  const [voicePace, setVoicePace] = useState<VoicePace>("normal");
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const [ideaNiche, setIdeaNiche] = useState("ancient-humans");
  const [ideas, setIdeas] = useState<{ title: string; reason: string }[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
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

  function canSubmit() {
    if (scriptMode === "ai") return topic.trim().length > 0;
    if (scriptMode === "custom") return customScript.trim().length > 0;
    return topic.trim().length > 0 && customScript.trim().length > 0;
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
      if (voicePreviewAudioRef.current) {
        voicePreviewAudioRef.current.pause();
      }
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
    if (!canSubmit()) return;
    setSubmitting(true);
    setJob(null);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        style,
        styleVariant,
        vibe,
        targetLengthSeconds: lengthSeconds,
        scriptMode,
        customScript: scriptMode === "ai" ? undefined : customScript,
        voiceGender,
        voiceName,
        voicePace,
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

  async function handleSuggestIdeas() {
    setIdeasLoading(true);
    try {
      const res = await fetch("/api/suggest-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: ideaNiche }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't generate ideas.");
      setIdeas(data.ideas || []);
    } catch (err) {
      console.error(err);
    }
    setIdeasLoading(false);
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
      // Surface it the same way a failed generation shows up.
      setJob({ ...job, error: err instanceof Error ? err.message : String(err) });
    }
    setRegeneratingScene(null);
  }

  async function handleApprove(stage: string, decision: "approve" | "regenerate" = "approve") {
    if (!job) return;
    setApproving(true);
    await approveStageApi(job.id, stage, decision, { voiceGender, voiceName, voicePace });
    setApproving(false);
  }

  const busy = submitting || (job !== null && job.status !== "done" && job.status !== "failed");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          marginBottom: 20,
          borderRadius: 999,
          border: "1px solid #d4af37",
          background: "rgba(212,175,55,0.1)",
          fontFamily: "sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: "#d4af37",
          letterSpacing: 0.3,
        }}
      >
        Best Performing · Ranked #32 out of 5,060
      </div>
      <div style={{ display: "flex", gap: 40, flexWrap: "wrap", fontFamily: "sans-serif" }}>
        {/* MAIN COLUMN */}
        <main style={{ flex: "2 1 480px", minWidth: 320 }}>
          <h1 style={{ fontSize: 28, marginBottom: 4, color: "#d4af37" }}>Moh Personal Videos Production</h1>
          <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 16 }}>Made by Mohjoo</p>
          <p style={{ color: "#cfc9ba", marginBottom: 32 }}>
            Type a topic — or bring your own script. Get a finished, narrated video.
          </p>

          <label style={labelStyle}>Script</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {(["ai", "custom", "hybrid"] as ScriptMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setScriptMode(mode)}
                style={{
                  flex: 1,
                  padding: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  border: scriptMode === mode ? "2px solid #d4af37" : "1px solid #ddd",
                  background: scriptMode === mode ? "#111" : "#fff",
                  color: scriptMode === mode ? "#d4af37" : "#111",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {mode === "ai" ? "AI writes it" : mode === "custom" ? "I'll paste my own" : "Mix (AI + mine)"}
              </button>
            ))}
          </div>

          {scriptMode !== "custom" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...labelStyle, marginBottom: 8 }}>Quick Start</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_START_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setStyle(preset.style);
                        setStyleVariant(preset.styleVariant);
                        setVibe(preset.vibe);
                        setLengthSeconds(preset.lengthSeconds);
                      }}
                      style={{
                        padding: "8px 14px",
                        fontSize: 13,
                        fontWeight: 600,
                        background:
                          style === preset.style && vibe === preset.vibe && styleVariant === preset.styleVariant
                            ? "#d4af37"
                            : "transparent",
                        color:
                          style === preset.style && vibe === preset.vibe && styleVariant === preset.styleVariant
                            ? "#0b0a08"
                            : "#cfc9ba",
                        border: "1px solid rgba(212,175,55,0.4)",
                        borderRadius: 20,
                        cursor: "pointer",
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }}>
                <label style={{ ...labelStyle, marginBottom: 8 }}>Need an idea? Pick a niche</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: ideas.length > 0 ? 12 : 0 }}>
                  <select value={ideaNiche} onChange={(e) => setIdeaNiche(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: "1 1 200px" }}>
                    <option value="ancient-humans">Ancient humans / survival</option>
                    <option value="forbidden-food">Forbidden food / predator-meat</option>
                    <option value="psychology">Psychology / named phenomena</option>
                    <option value="dark-history">Dark or brutal history</option>
                    <option value="space">Space & unexplained mysteries</option>
                    <option value="animal-behavior">Animal behavior / predator-prey</option>
                  </select>
                  <button
                    onClick={handleSuggestIdeas}
                    disabled={ideasLoading}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      background: "transparent",
                      color: "#d4af37",
                      border: "1px solid #d4af37",
                      borderRadius: 8,
                      cursor: ideasLoading ? "default" : "pointer",
                      opacity: ideasLoading ? 0.6 : 1,
                    }}
                  >
                    {ideasLoading ? "Thinking..." : "Suggest 5 ideas"}
                  </button>
                </div>
                {ideas.map((idea, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setTopic(idea.title);
                      setIdeas([]);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: "rgba(212,175,55,0.06)",
                      border: "1px solid rgba(212,175,55,0.25)",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#f2eee3" }}>{idea.title}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9d9784" }}>{idea.reason}</p>
                  </button>
                ))}
              </div>

              <label style={labelStyle}>Topic</label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. how to stop procrastinating"
                rows={2}
                style={inputStyle}
              />
            </>
          )}

          {scriptMode !== "ai" && (
            <>
              <label style={labelStyle}>
                {scriptMode === "custom" ? "Your script" : "Your draft (AI will expand and polish it)"}
              </label>
              <textarea
                value={customScript}
                onChange={(e) => setCustomScript(e.target.value)}
                placeholder="Paste your script here..."
                rows={6}
                style={inputStyle}
              />
            </>
          )}

          <label style={labelStyle}>Vibe</label>
          <select value={vibe} onChange={(e) => setVibe(e.target.value as ScriptVibe)} style={inputStyle}>
            <option value="fun-shorts">Fun / Casual (YouTube Shorts energy)</option>
            <option value="storytime">Storytime / Relatable</option>
            <option value="hype">Hype / High-energy hook</option>
            <option value="topx">Top X / Countdown list</option>
            <option value="sleep">Sleep / Calm ambient</option>
            <option value="documentary">Documentary / Serious</option>
            <option value="viral-explainer">Viral Explainer (evidence-dense, cold open, callbacks)</option>
          </select>

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

          <label style={labelStyle}>Voice</label>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
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
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "transparent",
              color: "#d4af37",
              border: "1px solid #d4af37",
              borderRadius: 8,
              cursor: previewingVoice ? "default" : "pointer",
              marginTop: -8,
              marginBottom: 20,
              opacity: previewingVoice ? 0.6 : 1,
            }}
          >
            {previewingVoice ? "Loading preview..." : "▶ Preview this voice & speed"}
          </button>
          {voicePreviewError && (
            <p style={{ color: "#e08a8a", fontSize: 13, marginTop: -14, marginBottom: 20 }}>{voicePreviewError}</p>
          )}

          <label style={labelStyle}>Length: {lengthSeconds}s</label>
          <input
            type="range"
            min={30}
            max={300}
            step={15}
            value={lengthSeconds}
            onChange={(e) => setLengthSeconds(Number(e.target.value))}
            style={{ width: "100%", marginBottom: 24 }}
          />

          <button
            onClick={handleGenerate}
            disabled={!!busy || !canSubmit()}
            style={{
              width: "100%",
              padding: 14,
              fontSize: 16,
              fontWeight: 600,
              background: "#d4af37",
              color: "#111",
              border: "none",
              borderRadius: 8,
              cursor: busy ? "default" : "pointer",
              opacity: busy || !canSubmit() ? 0.6 : 1,
            }}
          >
            {busy ? "Working..." : "Generate video"}
          </button>

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

          <div style={{ marginTop: 48 }}>
            <h2 style={{ fontSize: 20, marginBottom: 16, color: "#f2eee3" }}>Past videos</h2>
            {libraryLoading && <p style={{ color: "#888" }}>Loading...</p>}
            {!libraryLoading && library.length === 0 && (
              <p style={{ color: "#888" }}>Nothing generated yet — your finished videos will show up here.</p>
            )}
            {library.map((v, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <p style={{ fontWeight: 600, margin: 0, color: "#f2eee3" }}>{v.title}</p>
                  <a href={v.url} download style={{ fontSize: 13, color: "#d4af37" }}>Download</a>
                </div>
                <video controls style={{ width: "100%", borderRadius: 8 }}>
                  <source src={v.url} type="video/mp4" />
                </video>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 48,
              paddingTop: 32,
              borderTop: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ fontSize: 20, marginBottom: 6, color: "#f2eee3" }}>Have a video to remix?</h2>
              <p style={{ color: "#b8b2a0", fontSize: 13, margin: 0, maxWidth: 480 }}>
                Upload a video and get an original one inspired by its topic and structure — its own script,
                not a copy. Remix now has its own page, so you can watch it happen live.
              </p>
            </div>
            <Link
              href="/remix"
              style={{
                flexShrink: 0,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                background: "transparent",
                color: "#d4af37",
                border: "1px solid #d4af37",
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              Go to Remix →
            </Link>
          </div>
        </main>

        {/* SIDEBAR: LIVE BOT ACTIVITY */}
        <ActivitySidebar job={job} />
      </div>

      <footer style={{ marginTop: 64, paddingTop: 32, borderTop: "1px solid rgba(255,255,255,0.15)", fontFamily: "sans-serif" }}>
        <h2 style={{ fontSize: 18, marginBottom: 20, color: "#f2eee3" }}>What powers this site</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
          {POWERED_BY.map((item) => (
            <div key={item.name}>
              <p style={{ fontWeight: 600, margin: "0 0 4px", color: "#d4af37" }}>{item.name}</p>
              <p style={{ fontSize: 13, color: "#b8b2a0", margin: 0, lineHeight: 1.5 }}>{item.does}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#8a8474", marginTop: 28 }}>
          Every tool here runs on a free tier — no subscriptions, no paid plans.
        </p>
      </footer>
    </div>
  );
}

const POWERED_BY = [
  { name: "Groq", does: "Writes the script, and transcribes uploaded videos for the remix feature." },
  { name: "Piper", does: "Self-hosted, open-source text-to-speech — 20 real voices, no API cap." },
  { name: "Pixabay", does: "Real stock video footage for Realistic-style videos, matched to each scene." },
  { name: "Pexels", does: "Backup photo source if Pixabay doesn't return a good match." },
  { name: "Pollinations", does: "Generates the AI illustrations for Whiteboard/Doodle and Cartoon styles." },
  { name: "VoiceRSS", does: "Automatic voiceover fallback if Piper fails on a given run." },
  { name: "FFmpeg", does: "Open-source engine that edits everything together — captions, timing, encoding." },
  { name: "Cloudinary", does: "Hosts and stores every finished video, and powers your past-videos library." },
  { name: "Tavily", does: "Optional — pulls real current search trends into the script when connected." },
];
