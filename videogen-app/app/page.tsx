"use client";

import { useState, useRef, useEffect } from "react";

type VideoStyle = "whiteboard-doodle" | "cartoon" | "realistic";

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

export default function Home() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<VideoStyle>("whiteboard-doodle");
  const [lengthSeconds, setLengthSeconds] = useState(60);
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

  async function handleGenerate() {
    if (!topic.trim()) return;
    setSubmitting(true);
    setJob(null);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, style, targetLengthSeconds: lengthSeconds }),
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
        Type a topic. Get a finished, narrated video.
      </p>

      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Topic</label>
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. how to stop procrastinating"
        rows={3}
        style={{ width: "100%", padding: 12, fontSize: 16, marginBottom: 20, boxSizing: "border-box" }}
      />

      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Style</label>
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as VideoStyle)}
        style={{ width: "100%", padding: 12, fontSize: 16, marginBottom: 20 }}
      >
        <option value="whiteboard-doodle">Whiteboard / Doodle</option>
        <option value="cartoon">Cartoon</option>
        <option value="realistic">Realistic</option>
      </select>

      <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
        Length: {lengthSeconds}s
      </label>
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
        disabled={!!busy || !topic.trim()}
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
          opacity: busy ? 0.6 : 1,
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
            <video controls style={{ width: "100%", marginTop: 16, borderRadius: 8 }}>
              <source src={job.outputVideoPath} type="video/mp4" />
            </video>
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
            <p style={{ fontWeight: 600, marginBottom: 6 }}>{v.title}</p>
            <video controls style={{ width: "100%", borderRadius: 8 }}>
              <source src={v.url} type="video/mp4" />
            </video>
          </div>
        ))}
      </div>
    </main>
  );
}
