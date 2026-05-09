import { describe, it, expect } from "vitest";
import { detectStuck } from "../index.js";

describe("detectStuck", () => {
  it("returns green when last commit was within 24h", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 100,
      hours_since_last_commit: 5,
      commit_cadence_per_day: 2,
      blocker_keyword_hits: 0,
    });
    expect(signal.signal).toBe("green");
  });

  it("returns yellow when 24h <= last commit < 72h", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 100,
      hours_since_last_commit: 48,
      commit_cadence_per_day: 1,
      blocker_keyword_hits: 0,
    });
    expect(signal.signal).toBe("yellow");
  });

  it("returns yellow when cadence < 0.5/day", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 100,
      hours_since_last_commit: 10,
      commit_cadence_per_day: 0.3,
      blocker_keyword_hits: 0,
    });
    expect(signal.signal).toBe("yellow");
  });

  it("returns red when last commit >= 72h", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 200,
      hours_since_last_commit: 80,
      commit_cadence_per_day: 0.1,
      blocker_keyword_hits: 0,
    });
    expect(signal.signal).toBe("red");
  });

  it("returns red when 2+ blocker keywords detected", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 100,
      hours_since_last_commit: 10,
      commit_cadence_per_day: 1,
      blocker_keyword_hits: 2,
    });
    expect(signal.signal).toBe("red");
  });

  it("attaches reasons array with the firing thresholds", () => {
    const signal = detectStuck({
      repo_full_name: "x/y",
      branch: "feat/test",
      developer_handle: "alice",
      branch_age_hours: 100,
      hours_since_last_commit: 80,
      commit_cadence_per_day: 0.3,
      blocker_keyword_hits: 0,
    });
    expect(signal.reasons.length).toBeGreaterThan(0);
    expect(signal.reasons[0].kind).toBeTruthy();
  });
});
