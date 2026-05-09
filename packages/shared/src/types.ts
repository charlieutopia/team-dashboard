export type Trajectory = "on_track" | "ahead" | "behind" | "stuck" | "no_activity";
export type DriftBucket = "covered" | "partial" | "out_of_scope" | "missing";
export type StuckSignalLevel = "green" | "yellow" | "red";

export interface DailyReportMetrics {
  commits_today: number;
  commits_yesterday: number;
  lines_added_today: number;
  lines_removed_today: number;
  files_touched_today: string[];
}

export interface DailyReportSpecProgress {
  advancing: { spec_item_path: string; advance_evidence: string }[];
  drifting: { spec_item_path: string; drift_evidence: string }[];
}

export interface DailyReport {
  developer_handle: string;
  date: string; // YYYY-MM-DD KL
  summary: string;
  metrics: DailyReportMetrics;
  spec_progress: DailyReportSpecProgress;
  trajectory: Trajectory;
  generator_version: string;
}

export interface DriftFinding {
  bucket: DriftBucket;
  spec_item_path: string;
  file_path?: string;
  line_range?: [number, number];
  evidence: string;
}

export interface DriftReport {
  developer_handle: string;
  date: string;
  findings: DriftFinding[];
  detector_version: string;
}

export interface StuckSignalReason {
  kind: string;
  value: number;
  threshold: number;
}

export interface StuckSignal {
  repo_full_name: string;
  branch: string;
  developer_handle: string | null;
  signal: StuckSignalLevel;
  reasons: StuckSignalReason[];
  branch_age_hours: number;
  hours_since_last_commit: number;
  commit_cadence_per_day: number;
  blocker_keyword_hits: number;
}
