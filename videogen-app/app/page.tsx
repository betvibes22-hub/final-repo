"use client";

import { useState, useRef, useEffect } from "react";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";
type ScriptVibe = "documentary" | "fun-shorts" | "storytime" | "hype";
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
          </select>

          <label style={labelStyle}>Style</label>
          <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} style={inputStyle}>
            <option value="whiteboard-doodle">Whiteboard / Doodle</option>
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
        </main>

        {/* SIDEBAR: LIVE BOT ACTIVITY */}
        <aside style={{ flex: "1 1 280px", minWidth: 260 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4, fontFamily: "sans-serif", color: "#f2eee3" }}>
            What the bot is doing
          </h2>
          <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 20, fontFamily: "sans-serif" }}>
            Live step-by-step as your video gets made.
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
  { name: "Groq", does: "Writes the script — a fast, free AI language model." },
  { name: "Pollinations.ai", does: "Generates the AI illustrations matching your chosen style." },
  { name: "Pexels", does: "Backup source for matching photos if AI generation doesn't return a good result." },
  { name: "VoiceRSS", does: "Turns the script into spoken narration." },
  { name: "FFmpeg", does: "Open-source engine that edits everything together — captions, transitions, timing." },
  { name: "Cloudinary", does: "Hosts and stores every finished video, and powers your past-videos library." },
  { name: "Tavily", does: "Optional — pulls real current search trends into the script when connected." },
];
