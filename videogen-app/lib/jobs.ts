import { ActivityLogEntry, Job, JobStatus } from "./types";
import { v4 as uuid } from "uuid";

// In-memory store. Fine for local dev and testing.
const jobs = new Map<string, Job>();

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
  return updateJob(id, { activityLog });
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

export function approveStage(jobId: string, stage: string, decision: ApprovalDecision): boolean {
  const key = `${jobId}:${stage}`;
  const resolve = pendingApprovals.get(key);
  if (!resolve) return false;
  pendingApprovals.delete(key);
  resolve(decision);
  return true;
}
