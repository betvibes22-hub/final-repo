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
    
        
          Turn any story into a Short
        
        
          One-line premise. Two characters. Animated in 5 scenes — Toonflow-style drama on our free stack.
        
      

      

          
          <textarea
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder={`e.g. ${PREMISE_EXAMPLES[genre][0].premise}`}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />

          
            Try these {GENRE_META[genre].label.toLowerCase()} premises
          
          

          
          

          
          

          
            {[
              { icon: "📱", label: "9:16 Shorts" },
              { icon: "🎬", label: "5-scene drama" },
              { icon: "⏱️", label: "~50 seconds" },
            ].map((b) => (
              
                {b.icon}{b.label}
              
            ))}
          

          
          
          
          {voicePreviewError && (
            {voicePreviewError}
          )}

          
          {submitError && (
            {submitError}
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
        

        <ActivitySidebar job={job} />
      
    
  );
}
