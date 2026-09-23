import fs from "fs";
import path from "path";
import { ActivityLogEntry, Job, JobStatus, VoiceGender, VoicePace } from "./types";
import { v4 as uuid } from "uuid";

// ---------------------------------------------------------------------------
// Disk persistence — survives Node process crashes within the same Render
// instance. Jobs are written through on every status change (not every
// activity-log line, to keep writes cheap). On a full server restart caused
// by a new deploy, in-flight jobs are lost (the pipeline thread is killed),
// but completed jobs remain readable.
// ---------------------------------------------------------------------------
const JOBS_FILE = path.join(
  process.env.JOBS_PERSIST_PATH || "/tmp",
  "videogen-jobs.json"
);

function loadPersistedJobs(): Map<string, Job> {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, "utf-8");
      const obj = JSON.parse(raw) as Record<string, Job>;
      return new Map(Object.entries(obj));
    }
  } catch (e) {
    console.warn("[jobs] Could not load persisted jobs:", (e as Error).message);
  }
  return new Map();
}

function persistJobs() {
  try {
    const obj = Object.fromEntries(jobs.entries());
    fs.writeFileSync(JOBS_FILE, JSON.stringify(obj), "utf-8");
  } catch (e) {
    console.warn("[jobs] Could not persist jobs:", (e as Error).message);
  }
}

// In-memory store, pre-seeded from disk on startup.
const jobs = loadPersistedJobs();

export type ApprovalDecision = "approve" | "regenerate";

// Pending approval resolvers — when the pipeline hits a checkpoint, it
// awaits a Promise whose resolve function is stashed here, keyed by
// "jobId:stage". Hitting the approve endpoint looks it up and resolves it
// with the user's decision, unblocking the paused pipeline either to
// continue (approve) or loop back and redo that stage (regenerate).
const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();

export function createJob(request: Job["request"]): Job {
  const job: Job = {
    id: uuid(),
    status: "queued",
    request,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activityLog: [],
  };
  jobs.set(job.id, job);
  persistJobs();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  const updated: Job = { ...existing, ...patch, updatedAt: Date.now() };
  jobs.set(id, updated);
  // Only flush to disk on status transitions — activity-log lines are
  // high-frequency and don't need to be durable mid-video.
  if (patch.status !== undefined) persistJobs();
  return updated;
}

export function setJobStatus(id: string, status: JobStatus, progressNote?: string) {
  return updateJob(id, { status, progressNote });
}

export function setJobFailed(id: string, error: string) {
  return updateJob(id, { status: "failed", error });
}

/**
 * Appends one line to the job's granular activity log — one call per
 * real thing that happens against an external service (a search, a
 * download, a synthesis call, an upload). Drives the detailed
 * per-service checklist in the sidebar. Capped so a very long/many-scene
 * video doesn't grow the in-memory job object unboundedly.
 */
export function logActivity(id: string, text: string, service: ActivityLogEntry["service"]) {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  const entry: ActivityLogEntry = { ts: Date.now(), text, service };
  const activityLog = [...existing.activityLog, entry].slice(-200);
  // Skip persistJobs() here — activity lines are fine to lose on crash.
  const updated: Job = { ...existing, activityLog, updatedAt: Date.now() };
  jobs.set(id, updated);
  return updated;
}

/**
 * Pauses the pipeline at a checkpoint (e.g. "script", "voice") and sets
 * the job's status to "awaiting_approval" with the stage name attached,
 * so the frontend can show the right preview + an Approve button. The
 * returned promise resolves once approveStage() is called for this
 * job+stage — the pipeline literally waits here until the user clicks.
 */
export function waitForApproval(jobId: string, stage: string): Promise<ApprovalDecision> {
  updateJob(jobId, {
    status: "awaiting_approval",
    awaitingStage: stage,
    progressNote: `Waiting for your OK on the ${stage}...`,
  });

  return new Promise((resolve) => {
    pendingApprovals.set(`${jobId}:${stage}`, resolve);
  });
}

export function approveStage(
  jobId: string,
  stage: string,
  decision: ApprovalDecision,
  voiceOverride?: { voiceGender?: VoiceGender; voiceName?: string; voicePace?: VoicePace }
): boolean {
  const key = `${jobId}:${stage}`;
  const resolve = pendingApprovals.get(key);
  if (!resolve) return false;

  // Regenerating the voice with a different voice/pace than originally
  // chosen — apply it to the job's request before the pipeline picks
  // back up, so the next attempt actually uses the new selection
  // instead of silently repeating the old one.
  if (stage === "voice" && decision === "regenerate" && voiceOverride) {
    const job = jobs.get(jobId);
    if (job) {
      updateJob(jobId, {
        request: {
          ...job.request,
          ...(voiceOverride.voiceGender ? { voiceGender: voiceOverride.voiceGender } : {}),
          ...(voiceOverride.voiceName ? { voiceName: voiceOverride.voiceName } : {}),
          ...(voiceOverride.voicePace ? { voicePace: voiceOverride.voicePace } : {}),
        },
      });
    }
  }

  pendingApprovals.delete(key);
  resolve(decision);
  return true;
}
