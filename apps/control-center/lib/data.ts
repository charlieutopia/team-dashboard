/**
 * Reads the local module data files the heartbeat produces.
 *
 * For now these are static files committed under apps/control-center/data/
 * (copied from the discarded charlie-work prototype). In production the local
 * heartbeat script writes status.json + questions.json; the app only reads
 * them. Server-side fs read keeps the data off the client bundle and works
 * the same on Vercel (files are part of the deployment).
 */
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// ---------- Job Monitor (status.json) ----------

export type JobState = 'ok' | 'fail' | 'disabled' | 'scheduled';

export interface Job {
  label: string;
  source: string;
  schedule_human: string;
  description: string;
  command: string;
  last_run: string | null;
  state: JobState;
}

export interface JobStatus {
  generated_at: string;
  host: string;
  job_count: number;
  counts: Partial<Record<JobState, number>>;
  jobs: Job[];
}

export async function loadJobStatus(): Promise<JobStatus> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'status.json'), 'utf8');
  return JSON.parse(raw) as JobStatus;
}

// ---------- Daily Grill (questions.json) ----------

export interface GrillQuestion {
  id: string;
  target?: string;
  question: string;
  why: string;
  metric_reason?: string;
  structure_target?: string;
  score?: number;
  priority?: number;
}

export interface GrillSet {
  generated_at: string;
  date: string;
  source?: string;
  phrasing?: string;
  count: number;
  questions: GrillQuestion[];
}

export async function loadGrill(): Promise<GrillSet> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'questions.json'), 'utf8');
  return JSON.parse(raw) as GrillSet;
}
