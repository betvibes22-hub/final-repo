"use client";

import { useState, useRef, useEffect } from "react";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";
type ScriptMode = "ai" | "custom" | "hybrid";

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

const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600 };

export default function Home() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
  const [lengthSeconds, setLengthSeconds] = useState(60);
  const [scriptMode, setScriptMode] = useState<ScriptMode>("ai");
  const [customScript, setCustomScript] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadLibrary() {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      setLibrary(data.videos ?? []);
    } catch {
      // Library is a nice-to-have — fail quietly if it can't load.
    }
    setLibraryLoading(false);
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  function canSubmit() {
    if (scriptMode === "ai") return topic.trim().length > 0;
    if (scriptMode === "custom") return customScript.trim().length > 0;
    return topic.trim().length > 0 && customScript.trim().length > 0; // hybrid
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
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>VideoGen</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
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
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>Past videos</h2>
        {libraryLoading && <p style={{ color: "#888" }}>Loading...</p>}
        {!libraryLoading && library.length === 0 && (
          <p style={{ color: "#888" }}>Nothing generated yet — your finished videos will show up here.</p>
        )}
        {library.map((v, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ fontWeight: 600, margin: 0 }}>{v.title}</p>
              <a href={v.url} download style={{ fontSize: 13, color: "#555" }}>
                Download
              </a>
            </div>
            <video controls style={{ width: "100%", borderRadius: 8 }}>
              <source src={v.url} type="video/mp4" />
            </video>
          </div>
        ))}
      </div>
    </main>
  );
}
