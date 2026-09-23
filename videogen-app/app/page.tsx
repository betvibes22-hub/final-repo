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
  const [voiceName, setVoiceName] = useState("en_US-amy-medium");
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
    
      {/* HEADER */}
      
        
          🎬 YouTube Shorts Generator
        
        
          What&apos;s the Difference?
        
        
          Type two concepts. Get a viral Short explaining the difference — stickman style, 9:16, ready to upload.
        
      

      

            
              vs
            

            
          

          {/* LOCKED FORMAT BADGE */}
          
            {[
              { icon: "🖊️", label: "Stickman" },
              { icon: "📱", label: "9:16 Shorts" },
              { icon: "⚡", label: "~45 seconds" },
              { icon: "🎯", label: "5-scene script" },
            ].map((badge) => (
              
                {badge.icon}
                {badge.label}
              
            ))}
          

          {/* VOICE PICKER */}
          
          
          
          {voicePreviewError && (
            
              {voicePreviewError}
            
          )}

          {/* GENERATE BUTTON */}
          

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
          
          

          {/* PAST VIDEOS */}
          
            Past videos
            {libraryLoading && Loading...}
            {!libraryLoading && library.length === 0 && (
              
                Nothing yet — your finished Shorts will show up here.
              
            )}
            {library.map((v, i) => (
              
                
                  {v.title}
                  
                    ↓ Download
                  
                
                
              
            ))}
          

          {/* OTHER TOOLS */}
          
            
              
                
                  🎭 Short Drama Generator
                
                
                  Premise + two characters → 5-scene animated drama Short.
                
              
              
            

            
              
                
                  🔁 Remix a video
                
                
                  Upload any video and get an original one inspired by its structure.
                
              
              
            
          
        

        {/* SIDEBAR */}
        <ActivitySidebar job={job} />
      

      {/* FOOTER */}
      
        {POWERED_BY.map((item) => (
          
            {item.name}
            {item.does}
          
        ))}
      
    
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
