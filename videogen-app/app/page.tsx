"use client";

import { useState, useRef, useEffect } from "react";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";
type ScriptMode = "ai" | "custom" | "hybrid";
type VoiceGender = "female" | "male";
type VoicePace = "slower" | "normal" | "faster";

interface JobState {
  id: string;
  status: string;
  progressNote?: string;
  outputVideoPath?: string;
  error?: string;
}

interface LibraryVideo {
  url: string;
  title: string;
  createdAt: string;
}

interface TrendingVideo {
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  viewCount: number;
  url: string;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "In the queue",
  writing_script: "Writing script",
  generating_voiceover: "Recording voiceover",
  generating_visuals: "Selecting footage",
  composing: "Editing final cut",
  uploading: "Saving your video",
  done: "It's a wrap",
  failed: "Cut! Something went wrong",
};

const VOICES_BY_GENDER: Record<VoiceGender, string[]> = {
  female: ["Linda", "Amy", "Mary"],
  male: ["John", "Mike"],
};

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

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
  return `${n} views`;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
  const [lengthSeconds, setLengthSeconds] = useState(60);
  const [scriptMode, setScriptMode] = useState<ScriptMode>("ai");
  const [customScript, setCustomScript] = useState("");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [voiceName, setVoiceName] = useState("Linda");
  const [voicePace, setVoicePace] = useState<VoicePace>("normal");
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [trending, setTrending] = useState<TrendingVideo[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadLibrary();
    loadTrending();
  }, []);

  async function loadLibrary() {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      setLibrary(data.videos ?? []);
    } catch {}
    setLibraryLoading(false);
  }

  async function loadTrending() {
    try {
      const res = await fetch("/api/trending");
      const data = await res.json();
      setTrending((data.videos ?? []).slice(0, 12));
    } catch {}
    setTrendingLoading(false);
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
                  border: scriptMode === mode ? "2px solid #111" : "1px solid #ddd",
                  background: scriptMode === mode ? "#111" : "#fff",
                  color: scriptMode === mode ? "#fff" : "#111",
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
                setVoiceName(VOICES_BY_GENDER[g][0]);
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
              {VOICES_BY_GENDER[voiceGender].map((name) => (
                <option key={name} value={name}>{name}</option>
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
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: busy ? "default" : "pointer",
              opacity: busy || !canSubmit() ? 0.6 : 1,
            }}
          >
            {busy ? "Working..." : "Generate video"}
          </button>

          {job && (
            <div style={{ marginTop: 32, padding: 20, background: "#f5f5f5", borderRadius: 8 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>
                Status: {STATUS_LABELS[job.status] ?? job.status}
              </p>
              {job.progressNote && <p style={{ color: "#555" }}>{job.progressNote}</p>}
              {job.error && <p style={{ color: "#c00" }}>Error: {job.error}</p>}
              {job.status === "done" && job.outputVideoPath && (
                <>
                  <video controls style={{ width: "100%", marginTop: 16, borderRadius: 8 }}>
                    <source src={job.outputVideoPath} type="video/mp4" />
                  </video>
                  <a
                    href={job.outputVideoPath}
                    download
                    style={{
                      display: "inline-block",
                      marginTop: 12,
                      padding: "8px 16px",
                      background: "#fff",
                      border: "1px solid #111",
                      borderRadius: 8,
                      color: "#111",
                      textDecoration: "none",
                      fontWeight: 600,
                      fontSize: 14,
                    }}
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
                  <p style={{ fontWeight: 600, margin: 0 }}>{v.title}</p>
                  <a href={v.url} download style={{ fontSize: 13, color: "#555" }}>Download</a>
                </div>
                <video controls style={{ width: "100%", borderRadius: 8 }}>
                  <source src={v.url} type="video/mp4" />
                </video>
              </div>
            ))}
          </div>
        </main>

        {/* SIDEBAR: EXPLORE */}
        <aside style={{ flex: "1 1 280px", minWidth: 260 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4, fontFamily: "sans-serif", color: "#f2eee3" }}>
            Explore — What's Trending Right Now
          </h2>
          <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 16, fontFamily: "sans-serif" }}>
            Real trending Shorts on YouTube today, for inspiration.
          </p>
          {trendingLoading && <p style={{ color: "#888", fontFamily: "sans-serif" }}>Loading...</p>}
          {!trendingLoading && trending.length === 0 && (
            <p style={{ color: "#888", fontSize: 13, fontFamily: "sans-serif" }}>
              Set YOUTUBE_API_KEY to see trending Shorts here.
            </p>
          )}
          {trending.map((v, i) => (
            <a
              key={i}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", gap: 10, marginBottom: 14, textDecoration: "none", color: "inherit" }}
            >
              {v.thumbnailUrl && (
                <img src={v.thumbnailUrl} alt="" style={{ width: 72, height: 96, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
              )}
              <div style={{ fontFamily: "sans-serif", minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", color: "#f2eee3" }}>
                  {v.title}
                </p>
                <p style={{ fontSize: 12, color: "#b8b2a0", margin: "4px 0 0" }}>{v.channelTitle}</p>
                <p style={{ fontSize: 12, color: "#b8b2a0", margin: 0 }}>{formatViews(v.viewCount)}</p>
              </div>
            </a>
          ))}
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
  { name: "YouTube Data API", does: "Optional — powers the trending Shorts explore panel when connected." },
];
