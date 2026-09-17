"use client";

import { useState, useRef, useEffect } from "react";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "stickman" | "realistic";
type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype" | "viral-explainer";
type ScriptMode = "ai" | "custom" | "hybrid";
type VoiceGender = "female" | "male";
type VoicePace = "slower" | "normal" | "faster";

interface SceneInfo {
  text: string;
}
interface ScriptInfo {
  title: string;
  scenes: SceneInfo[];
}

interface ActivityLogEntry {
  ts: number;
  text: string;
  service: "groq" | "tavily" | "piper" | "voicerss" | "pixabay" | "pexels" | "pollinations" | "ffmpeg" | "cloudinary";
}

interface JobState {
  id: string;
  status: string;
  awaitingStage?: string;
  progressNote?: string;
  outputVideoPath?: string;
  voiceoverPreviewUrl?: string;
  script?: ScriptInfo;
  error?: string;
  request?: { scriptMode?: ScriptMode };
  activityLog?: ActivityLogEntry[];
}

interface LibraryVideo {
  url: string;
  title: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "In the queue",
  writing_script: "Writing script",
  awaiting_approval: "Waiting on you",
  generating_voiceover: "Recording voiceover",
  generating_visuals: "Selecting footage",
  composing: "Editing final cut",
  uploading: "Saving your video",
  done: "It's a wrap",
  failed: "Cut! Something went wrong",
};

// Mirrors the voice catalog in lib/providers/piperTts.ts — keep in sync.
const VOICES_BY_GENDER: Record<VoiceGender, { key: string; name: string }[]> = {
  female: [
    { key: "en_US-amy-medium", name: "Amy" },
    { key: "en_US-kathleen-low", name: "Kathleen" },
    { key: "en_US-kristin-medium", name: "Kristin" },
    { key: "en_US-hfc_female-medium", name: "Hannah" },
    { key: "en_US-ljspeech-medium", name: "Lucy" },
    { key: "en_US-lessac-medium", name: "Lessac" },
    { key: "en_GB-jenny_dioco-medium", name: "Jenny (British)" },
    { key: "en_GB-southern_english_female-low", name: "Southern (British)" },
    { key: "en_GB-alba-medium", name: "Alba (Scottish)" },
    { key: "en_GB-cori-medium", name: "Cori (British)" },
  ],
  male: [
    { key: "en_US-danny-low", name: "Danny" },
    { key: "en_US-joe-medium", name: "Joe" },
    { key: "en_US-john-medium", name: "John" },
    { key: "en_US-ryan-medium", name: "Ryan" },
    { key: "en_US-norman-medium", name: "Norman" },
    { key: "en_US-hfc_male-medium", name: "Marcus" },
    { key: "en_US-bryce-medium", name: "Bryce" },
    { key: "en_US-reza_ibrahim-medium", name: "Reza" },
    { key: "en_GB-alan-medium", name: "Alan (British)" },
    { key: "en_GB-northern_english_male-medium", name: "Northern (British)" },
  ],
};

const TIMELINE_STEPS = [
  { key: "writing_script", label: "Writing script" },
  { key: "script_review", label: "Script review" },
  { key: "generating_voiceover", label: "Recording voiceover" },
  { key: "voice_review", label: "Voice review" },
  { key: "generating_visuals", label: "Selecting footage" },
  { key: "composing", label: "Editing final cut" },
  { key: "uploading", label: "Saving video" },
  { key: "done", label: "Done" },
];

const SERVICE_META: Record<ActivityLogEntry["service"], { label: string; color: string }> = {
  groq: { label: "Groq (script)", color: "#d4af37" },
  tavily: { label: "Tavily (trends)", color: "#8ab4f8" },
  piper: { label: "Piper (voice)", color: "#c792ea" },
  voicerss: { label: "VoiceRSS (voice fallback)", color: "#c792ea" },
  pixabay: { label: "Pixabay (footage)", color: "#7ec699" },
  pexels: { label: "Pexels (footage fallback)", color: "#7ec699" },
  pollinations: { label: "Pollinations (AI illustrations)", color: "#e07af2" },
  ffmpeg: { label: "FFmpeg (editing)", color: "#f2994a" },
  cloudinary: { label: "Cloudinary (storage)", color: "#56ccf2" },
};

const ALL_SERVICES: ActivityLogEntry["service"][] = [
  "groq",
  "tavily",
  "piper",
  "voicerss",
  "pixabay",
  "pexels",
  "pollinations",
  "ffmpeg",
  "cloudinary",
];

function currentTimelineKey(job: JobState | null): string | null {
  if (!job) return null;
  if (job.status === "awaiting_approval") {
    return job.awaitingStage === "script" ? "script_review" : "voice_review";
  }
  return job.status;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  fontSize: 16,
  marginBottom: 20,
  boxSizing: "border-box",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600, color: "#f2eee3" };

const approveBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "#d4af37",
  color: "#111",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 12,
};

const disapproveBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  background: "transparent",
  color: "#d4af37",
  border: "1px solid #d4af37",
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 12,
  marginLeft: 10,
};

export default function Home() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
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
  const [remixFile, setRemixFile] = useState<File | null>(null);
  const [remixSubmitting, setRemixSubmitting] = useState(false);
  const [remixError, setRemixError] = useState<string | null>(null);
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
      const res = await fetch(`/api/status?jobId=${jobId}`);
      const data = await res.json();
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.status === "done") loadLibrary();
      }
    }, 2000);
  }

  async function handleRemixSubmit() {
    if (!remixFile) return;
    setRemixSubmitting(true);
    setRemixError(null);
    try {
      const form = new FormData();
      form.append("video", remixFile);
      form.append("style", style);
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
      setRemixError(err instanceof Error ? err.message : String(err));
    }
    setRemixSubmitting(false);
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
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, stage, decision }),
    });
    setApproving(false);
  }

  const busy = submitting || (job && job.status !== "done" && job.status !== "failed");

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
            <div style={{ marginTop: 32, padding: 20, background: "rgba(255,255,255,0.06)", borderRadius: 8 }}>
              <p style={{ fontWeight: 600, marginBottom: 4, color: "#f2eee3" }}>
                Status: {STATUS_LABELS[job.status] ?? job.status}
              </p>
              {job.progressNote && <p style={{ color: "#b8b2a0" }}>{job.progressNote}</p>}
              {job.error && <p style={{ color: "#e08a8a" }}>Error: {job.error}</p>}

              {/* Script approval checkpoint */}
              {job.status === "awaiting_approval" && job.awaitingStage === "script" && job.script && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontWeight: 600, color: "#d4af37", marginBottom: 8 }}>{job.script.title}</p>
                  <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 14, lineHeight: 1.6, color: "#e8e4d8" }}>
                    {job.script.scenes.map((s, i) => (
                      <p key={i} style={{ marginBottom: 10 }}>{s.text}</p>
                    ))}
                  </div>
                  <div>
                    <button onClick={() => handleApprove("script", "approve")} disabled={approving} style={approveBtnStyle}>
                      {approving ? "..." : "Approve script & continue"}
                    </button>
                    {job.request?.scriptMode !== "custom" && (
                      <button onClick={() => handleApprove("script", "regenerate")} disabled={approving} style={disapproveBtnStyle}>
                        {approving ? "..." : "Try a different script"}
                      </button>
                    )}
                  </div>
                  {job.request?.scriptMode === "custom" && (
                    <p style={{ fontSize: 12, color: "#8b8574", marginTop: 6 }}>
                      Custom mode uses your pasted text as-is — edit it above and resubmit to change it.
                    </p>
                  )}
                </div>
              )}

              {/* Voice approval checkpoint */}
              {job.status === "awaiting_approval" && job.awaitingStage === "voice" && job.voiceoverPreviewUrl && (
                <div style={{ marginTop: 16 }}>
                  <audio controls style={{ width: "100%" }} src={job.voiceoverPreviewUrl} />
                  <div>
                    <button onClick={() => handleApprove("voice", "approve")} disabled={approving} style={approveBtnStyle}>
                      {approving ? "..." : "Approve voice & continue"}
                    </button>
                    <button onClick={() => handleApprove("voice", "regenerate")} disabled={approving} style={disapproveBtnStyle}>
                      {approving ? "..." : "Try again"}
                    </button>
                  </div>
                </div>
              )}

              {job.status === "done" && job.outputVideoPath && (
                <>
                  <video controls style={{ width: "100%", marginTop: 16, borderRadius: 8 }}>
                    <source src={job.outputVideoPath} type="video/mp4" />
                  </video>
                  <a
                    href={job.outputVideoPath}
                    download
                    style={{ display: "inline-block", marginTop: 12, padding: "8px 16px", background: "transparent", border: "1px solid #d4af37", borderRadius: 8, color: "#d4af37", textDecoration: "none", fontWeight: 600, fontSize: 14 }}
                  >
                    Download
                  </a>

                  {job.script && job.script.scenes.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 10 }}>
                        Not happy with a scene? Redo just that one
                      </p>
                      {job.script.scenes.map((scene, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "10px 0",
                            borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <p style={{ fontSize: 13, color: "#cfc9ba", margin: 0, flex: 1 }}>
                            <span style={{ color: "#8a8474" }}>Scene {i + 1}:</span> {scene.text}
                          </p>
                          <button
                            onClick={() => handleRegenerateScene(i)}
                            disabled={regeneratingScene !== null}
                            style={{
                              flexShrink: 0,
                              padding: "6px 12px",
                              fontSize: 12,
                              fontWeight: 600,
                              background: "transparent",
                              color: "#d4af37",
                              border: "1px solid #d4af37",
                              borderRadius: 6,
                              cursor: regeneratingScene !== null ? "default" : "pointer",
                              opacity: regeneratingScene !== null ? 0.5 : 1,
                            }}
                          >
                            {regeneratingScene === i ? "Redoing..." : "Redo"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
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

          <div style={{ marginTop: 48, paddingTop: 32, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <h2 style={{ fontSize: 20, marginBottom: 6, color: "#f2eee3" }}>Remix a video</h2>
            <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 16 }}>
              Upload a video and this makes an original one inspired by its topic and structure — same voice/style
              settings as above, but its own script written from scratch, not a copy. Works best under a few
              minutes long.
            </p>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setRemixFile(e.target.files?.[0] ?? null)}
              style={{ color: "#cfc9ba", fontSize: 13, marginBottom: 12, display: "block" }}
            />
            <button
              onClick={handleRemixSubmit}
              disabled={!remixFile || remixSubmitting}
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                background: remixFile ? "#d4af37" : "transparent",
                color: remixFile ? "#0b0a08" : "#6b6656",
                border: "1px solid #d4af37",
                borderRadius: 8,
                cursor: !remixFile || remixSubmitting ? "default" : "pointer",
                opacity: remixSubmitting ? 0.6 : 1,
              }}
            >
              {remixSubmitting ? "Uploading & transcribing..." : "Remix this video"}
            </button>
            {remixError && <p style={{ color: "#e08a8a", fontSize: 13, marginTop: 10 }}>{remixError}</p>}
          </div>
        </main>

        {/* SIDEBAR: LIVE BOT ACTIVITY */}
        <aside style={{ flex: "1 1 280px", minWidth: 260 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4, fontFamily: "sans-serif", color: "#f2eee3" }}>
            What the bot is doing
          </h2>
          <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 20, fontFamily: "sans-serif" }}>
            It works through every service in full — real searches, real downloads, real encodes — and takes
            however long that needs. Nothing here is simulated.
          </p>

          {!job && (
            <p style={{ color: "#8a8474", fontSize: 13, fontFamily: "sans-serif" }}>
              Nothing running right now — generate a video to watch it happen here.
            </p>
          )}

          {job && (
            <div style={{ fontFamily: "sans-serif" }}>
              {TIMELINE_STEPS.map((step) => {
                const currentKey = currentTimelineKey(job);
                const stepOrder = TIMELINE_STEPS.findIndex((s) => s.key === step.key);
                const currentOrder = TIMELINE_STEPS.findIndex((s) => s.key === currentKey);
                const isDone = job.status === "done" || (currentOrder >= 0 && stepOrder < currentOrder);
                const isCurrent = step.key === currentKey && job.status !== "done";

                return (
                  <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: isDone ? "#d4af37" : isCurrent ? "#f2eee3" : "rgba(255,255,255,0.15)",
                        boxShadow: isCurrent ? "0 0 8px #f2eee3" : "none",
                      }}
                    />
                    <span style={{ fontSize: 13, color: isDone || isCurrent ? "#f2eee3" : "#6b6656", fontWeight: isCurrent ? 600 : 400 }}>
                      {step.label}
                    </span>
                  </div>
                );
              })}

              {/* SERVICE CHECKLIST — every external service this video touches,
                  ticked off as the bot actually engages with each one. */}
              <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 12 }}>
                  Service checklist
                </p>
                {ALL_SERVICES.map((svc) => {
                  const entries = (job.activityLog ?? []).filter((e) => e.service === svc);
                  const touched = entries.length > 0;
                  const latest = entries[entries.length - 1];
                  const meta = SERVICE_META[svc];
                  return (
                    <div key={svc} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          marginTop: 5,
                          background: touched ? meta.color : "rgba(255,255,255,0.12)",
                        }}
                      />
                      <div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: touched ? "#f2eee3" : "#6b6656",
                          }}
                        >
                          {meta.label}
                        </span>
                        {latest && (
                          <p style={{ fontSize: 11.5, color: "#9d9784", margin: "2px 0 0", lineHeight: 1.4 }}>
                            {latest.text}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DETAILED LIVE LOG — every real action, newest first. */}
              {job.activityLog && job.activityLog.length > 0 && (
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                  <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 12 }}>
                    Live log
                  </p>
                  <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                    {[...job.activityLog].reverse().map((entry, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            flexShrink: 0,
                            marginTop: 5,
                            background: SERVICE_META[entry.service].color,
                          }}
                        />
                        <p style={{ fontSize: 12, color: "#cfc9ba", margin: 0, lineHeight: 1.45 }}>{entry.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
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
