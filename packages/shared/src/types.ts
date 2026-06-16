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

export type Momentum =
  | "accelerating"
  | "steady"
  | "slowing"
  | "stalled"
  | "no_activity";

export interface WeeklyReport {
  developer_handle: string;
  week_start_date: string; // YYYY-MM-DD KL Monday
  summary: string;
  momentum: Momentum;
  top_themes: string[];
  generator_version: string;
}

export interface MonthlyReport {
  developer_handle: string;
  month_start_date: string; // YYYY-MM-DD KL first-of-month
  summary: string;
  momentum: Momentum;
  top_themes: string[];
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

// Phase 2 quality — the five-band scale a single quality dimension can land on.
// 'skipped' means the dimension had no evidence this week (e.g. no code branches
// for test discipline), distinct from 'weak' which is a real low score.
export type QualityBand =
  | "weak"
  | "developing"
  | "solid"
  | "strong"
  | "skipped";

// One developer's weekly quality scorecard — mirrors the
// team_dashboard.weekly_quality_reports columns. Each dimension carries a band
// plus a short human-readable evidence string. Dimensions not yet computed are
// null (the Phase 2 build ships test discipline first; the rest fill in later).
export interface WeeklyQualityReport {
  developer_id: string;
  week_start_date: string; // YYYY-MM-DD KL Monday

  test_discipline_band: QualityBand | null;
  test_discipline_evidence: string | null;

  stability_band: QualityBand | null;
  stability_evidence: string | null;

  code_care_band: QualityBand | null;
  code_care_evidence: string | null;

  review_citizenship_band: QualityBand | null;
  review_citizenship_evidence: string | null;

  clarity_band: QualityBand | null;
  clarity_evidence: string | null;

  headline: string | null;
  needs_a_chat: boolean | null;
  level_snapshot: string | null;

  computed_at: string | null;
  scanner_version: string | null;
  error_msg: string | null;
}
