import { Job, JobStatus } from "./types";
import { v4 as uuid } from "uuid";

// In-memory store. Fine for local dev and testing.
// In production, swap this for Redis (or a Postgres table) so jobs survive
// server restarts and work across multiple server instances.
const jobs = new Map<string, Job>();

export function createJob(request: Job["request"]): Job {
  const job: Job = {
    id: uuid(),
    status: "queued",
    request,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
