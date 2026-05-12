import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWeekly } from "../run-weekly.js";
import type { WeeklyReport } from "@team-dashboard/shared";

const WEEK_START = "2026-05-04"; // Monday

interface MockDailyRow {
  developer_id: string;
  report_date: string;
  summary: string | null;
  trajectory: string | null;
  metrics: any;
  parse_failed: boolean;
}

interface MockSbConfig {
  developers?: { id: string; github_handle: string; display_name: string | null }[];
  dailyByDev?: Record<string, MockDailyRow[]>;
}

function makeMockSb(cfg: MockSbConfig = {}) {
  const upsertCalls: { row: any; opts: any }[] = [];
  const developers = cfg.developers ?? [];
  const dailyByDev = cfg.dailyByDev ?? {};

  const from = vi.fn((table: string) => {
    if (table === "developers") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({ data: developers, error: null }),
          ),
        })),
      };
    }
    if (table === "daily_reports") {
      return {
        select: vi.fn(() => {
          const state: { devId?: string; gte?: string; lte?: string } = {};
          const chain = {
            eq: vi.fn((col: string, val: string) => {
              if (col === "developer_id") state.devId = val;
              return chain;
            }),
            gte: vi.fn((col: string, val: string) => {
              state.gte = val;
              return chain;
            }),
            lte: vi.fn((col: string, val: string) => {
              state.lte = val;
              return chain;
            }),
            order: vi.fn(() =>
              Promise.resolve({
                data: (dailyByDev[state.devId ?? ""] ?? []).filter(
                  (r) =>
                    r.report_date >= (state.gte ?? "") &&
                    r.report_date <= (state.lte ?? ""),
                ),
                error: null,
              }),
            ),
          };
          return chain;
        }),
      };
    }
    if (table === "weekly_reports") {
      return {
        upsert: vi.fn((row: any, opts: any) => {
          upsertCalls.push({ row, opts });
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    sb: { from } as any,
    upsertCalls,
  };
}

const validReport: WeeklyReport = {
  developer_handle: "alice",
  week_start_date: WEEK_START,
  summary: "Alice had a strong week shipping the new flow.",
  momentum: "accelerating",
  top_themes: ["new flow shipped", "tighter testing", "fewer bug reports"],
  generator_version: "v1+claude-code-headless-weekly",
};

function makeDailyRows(devId: string, dates: string[]): MockDailyRow[] {
  return dates.map((d, i) => ({
    developer_id: devId,
    report_date: d,
    summary: `day ${i + 1} summary`,
    trajectory: "on_track",
    metrics: {
      commits_today: 2,
      commits_yesterday: 1,
      lines_added_today: 100,
      lines_removed_today: 20,
      files_touched_today: ["a.ts"],
    },
    parse_failed: false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWeekly", () => {
  it("happy path: 1 dev with 5 days produces 1 weekly row via analyze", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice Lee" },
      ],
      dailyByDev: {
        "dev-alice": makeDailyRows("dev-alice", [
          "2026-05-04",
          "2026-05-05",
          "2026-05-06",
          "2026-05-07",
          "2026-05-08",
        ]),
      },
    });
    const analyze = vi.fn(async () => validReport);

    const result = await runWeekly({ sb, analyze, weekStart: WEEK_START });

    expect(result.developers_enumerated).toBe(1);
    expect(result.weeks_succeeded).toBe(1);
    expect(result.weeks_failed).toBe(0);
    expect(result.skipped_too_little_data).toBe(0);

    expect(analyze).toHaveBeenCalledOnce();
    const analyzeArg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; week_start_date: string; days: { report_date: string; parse_failed: boolean }[] }])[0];
    expect(analyzeArg.developer_handle).toBe("alice");
    expect(analyzeArg.display_name).toBe("Alice Lee");
    expect(analyzeArg.week_start_date).toBe(WEEK_START);
    expect(analyzeArg.days).toHaveLength(5);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.row.summary).toBe(
      "Alice had a strong week shipping the new flow.",
    );
    expect(upsertCalls[0]!.row.momentum).toBe("accelerating");
    expect(upsertCalls[0]!.row.parse_failed).toBe(false);
    expect(upsertCalls[0]!.opts).toEqual({
      onConflict: "developer_id,week_start_date",
    });
  });

  it("skips dev with fewer than minDays daily rows (default 3)", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-bob", github_handle: "bob", display_name: "Bob Tan" },
      ],
      dailyByDev: {
        "dev-bob": makeDailyRows("dev-bob", ["2026-05-04", "2026-05-05"]),
      },
    });
    const analyze = vi.fn(async () => validReport);

    const result = await runWeekly({ sb, analyze, weekStart: WEEK_START });

    expect(result.skipped_too_little_data).toBe(1);
    expect(result.weeks_succeeded).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it("respects minDays override (test mode = 1)", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-bob", github_handle: "bob", display_name: "Bob Tan" },
      ],
      dailyByDev: {
        "dev-bob": makeDailyRows("dev-bob", ["2026-05-04"]),
      },
    });
    const analyze = vi.fn(async () => ({ ...validReport, developer_handle: "bob" }));

    const result = await runWeekly({
      sb,
      analyze,
      weekStart: WEEK_START,
      minDays: 1,
    });

    expect(result.weeks_succeeded).toBe(1);
    expect(result.skipped_too_little_data).toBe(0);
    expect(analyze).toHaveBeenCalledOnce();
    expect(upsertCalls).toHaveLength(1);
  });

  it("filters out parse_failed daily rows from analyze input (no garbage in)", async () => {
    const goodRow = makeDailyRows("dev-alice", ["2026-05-04"])[0]!;
    const badRow: MockDailyRow = {
      developer_id: "dev-alice",
      report_date: "2026-05-05",
      summary: null,
      trajectory: null,
      metrics: null,
      parse_failed: true,
    };
    const { sb } = makeMockSb({
      developers: [
        {
          id: "dev-alice",
          github_handle: "alice",
          display_name: "Alice Lee",
        },
      ],
      dailyByDev: {
        "dev-alice": [
          goodRow,
          badRow,
          ...makeDailyRows("dev-alice", ["2026-05-06", "2026-05-07"]),
        ],
      },
    });
    const analyze = vi.fn(async () => validReport);

    await runWeekly({ sb, analyze, weekStart: WEEK_START });

    const analyzeArg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; week_start_date: string; days: { report_date: string; parse_failed: boolean }[] }])[0];
    // 4 rows from supabase but only 3 non-failed should be passed to analyze
    expect(analyzeArg.days).toHaveLength(3);
    expect(analyzeArg.days.every((d: any) => !d.parse_failed)).toBe(true);
  });

  it("upserts parse_failed=true row when analyze returns failure", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice Lee" },
      ],
      dailyByDev: {
        "dev-alice": makeDailyRows("dev-alice", [
          "2026-05-04",
          "2026-05-05",
          "2026-05-06",
        ]),
      },
    });
    const analyze = vi.fn(async () => ({
      parse_failed: true as const,
      error_msg: "boom",
      developer_handle: "alice",
      week_start_date: WEEK_START,
    }));

    const result = await runWeekly({ sb, analyze, weekStart: WEEK_START });

    expect(result.weeks_failed).toBe(1);
    expect(result.weeks_succeeded).toBe(0);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.row.parse_failed).toBe(true);
    expect(upsertCalls[0]!.row.error_msg).toBe("boom");
    expect(upsertCalls[0]!.row.summary).toBeNull();
    expect(upsertCalls[0]!.row.momentum).toBeNull();
  });

  it("throw safety: analyze throws — counted as failure, loop continues", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice Lee" },
        { id: "dev-bob", github_handle: "bob", display_name: "Bob Tan" },
      ],
      dailyByDev: {
        "dev-alice": makeDailyRows("dev-alice", [
          "2026-05-04",
          "2026-05-05",
          "2026-05-06",
        ]),
        "dev-bob": makeDailyRows("dev-bob", [
          "2026-05-04",
          "2026-05-05",
          "2026-05-06",
        ]),
      },
    });
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ...validReport, developer_handle: "bob" });

    const result = await runWeekly({ sb, analyze, weekStart: WEEK_START });

    expect(result.developers_enumerated).toBe(2);
    expect(result.weeks_succeeded).toBe(1);
    expect(result.weeks_failed).toBe(1);
    expect(upsertCalls).toHaveLength(2);
    const aliceUpsert = upsertCalls.find((u) => u.row.developer_id === "dev-alice");
    expect(aliceUpsert?.row.parse_failed).toBe(true);
    expect(aliceUpsert?.row.error_msg).toMatch(/analyze threw/);
  });

  it("computes 7-day window from weekStart inclusive", async () => {
    // weekStart=2026-05-04 (Mon) → window [2026-05-04, 2026-05-10] (Sun)
    // Day at 2026-05-11 (next Monday) must NOT be included
    const inWindow = makeDailyRows("dev-alice", [
      "2026-05-04",
      "2026-05-10",
    ]);
    const outWindow = makeDailyRows("dev-alice", ["2026-05-11"]);
    const { sb } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice Lee" },
      ],
      dailyByDev: { "dev-alice": [...inWindow, ...outWindow] },
    });
    const analyze = vi.fn(async () => validReport);

    await runWeekly({ sb, analyze, weekStart: WEEK_START, minDays: 1 });

    const analyzeArg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; week_start_date: string; days: { report_date: string; parse_failed: boolean }[] }])[0];
    expect(analyzeArg.days).toHaveLength(2);
    expect(analyzeArg.days.map((d: any) => d.report_date)).toEqual([
      "2026-05-04",
      "2026-05-10",
    ]);
  });
});
