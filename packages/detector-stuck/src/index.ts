import type { StuckSignal, StuckSignalReason } from "@team-dashboard/shared";

interface DetectStuckInput {
  repo_full_name: string;
  branch: string;
  developer_handle: string | null;
  branch_age_hours: number;
  hours_since_last_commit: number;
  commit_cadence_per_day: number;
  blocker_keyword_hits: number;
}

export function detectStuck(input: DetectStuckInput): StuckSignal {
  const reasons: StuckSignalReason[] = [];
  let signal: "green" | "yellow" | "red" = "green";

  if (input.hours_since_last_commit >= 72) {
    signal = "red";
    reasons.push({ kind: "hours_since_last_commit", value: input.hours_since_last_commit, threshold: 72 });
  } else if (input.hours_since_last_commit >= 24) {
    signal = "yellow";
    reasons.push({ kind: "hours_since_last_commit", value: input.hours_since_last_commit, threshold: 24 });
  }

  if (input.commit_cadence_per_day < 0.5 && signal === "green") {
    signal = "yellow";
  }
  if (input.commit_cadence_per_day < 0.5) {
    reasons.push({ kind: "commit_cadence_per_day", value: input.commit_cadence_per_day, threshold: 0.5 });
  }

  if (input.blocker_keyword_hits >= 2) {
    signal = "red";
    reasons.push({ kind: "blocker_keyword_hits", value: input.blocker_keyword_hits, threshold: 2 });
  }

  return {
    repo_full_name: input.repo_full_name,
    branch: input.branch,
    developer_handle: input.developer_handle,
    signal,
    reasons,
    branch_age_hours: input.branch_age_hours,
    hours_since_last_commit: input.hours_since_last_commit,
    commit_cadence_per_day: input.commit_cadence_per_day,
    blocker_keyword_hits: input.blocker_keyword_hits,
  };
}
