import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMonthly } from "../run-monthly.js";
import type { MonthlyReport } from "@team-dashboard/shared";

const MONTH_START = "2026-04-01";

interface MockDailyRow {
  developer_id: string;
  report_date: string;
  summary: string | null;
  trajectory: string | null;
  metrics: any;
  parse_failed: boolean;
}

interface MockWeeklyRow {
  developer_id: string;
  week_start_date: string;
  summary: string | null;
  momentum: string | null;
  top_themes: string[] | null;
  parse_failed: boolean;
}

interface MockLeaveRow {
  developer_id: string;
  leave_date: string;
  is_half_day: boolean;
}

interface MockPhRow {
  holiday_date: string;
}

interface MockSbConfig {
  developers?: { id: string; github_handle: string; display_name: string | null }[];
  daily?: MockDailyRow[];
  weekly?: MockWeeklyRow[];
  leaves?: MockLeaveRow[];
  publicHolidays?: MockPhRow[];
}

function makeMockSb(cfg: MockSbConfig = {}) {
  const upsertCalls: { row: any; opts: any }[] = [];
  const developers = cfg.developers ?? [];
  const daily = cfg.daily ?? [];
  const weekly = cfg.weekly ?? [];
  const leaves = cfg.leaves ?? [];
  const phs = cfg.publicHolidays ?? [];

  const buildRangeQuery =
    <T extends Record<string, any>>(
      rows: T[],
      dateCol: keyof T & string,
      devIdCol: keyof T & string,
    ) =>
    () => {
      const state: { ids?: string[]; gte?: string; lte?: string } = {};
      const chain: any = {
        in: vi.fn((col: string, vals: string[]) => {
          if (col === devIdCol) state.ids = vals;
          return chain;
        }),
        gte: vi.fn((col: string, val: string) => {
          if (col === dateCol) state.gte = val;
          return chain;
        }),
        lte: vi.fn((col: string, val: string) => {
          if (col === dateCol) state.lte = val;
          // Treat .lte() as terminal — return the promise here
          const filtered = rows.filter(
            (r) =>
              (state.ids ?? []).includes(String(r[devIdCol])) &&
              String(r[dateCol]) >= (state.gte ?? "") &&
              String(r[dateCol]) <= (state.lte ?? ""),
          );
          return Promise.resolve({ data: filtered, error: null });
        }),
      };
      return chain;
    };

  const buildPhQuery = () => () => {
    const state: { gte?: string; lte?: string } = {};
    const chain: any = {
      eq: vi.fn(() => chain), // state filter — applied implicitly
      gte: vi.fn((col: string, val: string) => {
        if (col === "holiday_date") state.gte = val;
        return chain;
      }),
      lte: vi.fn((col: string, val: string) => {
        if (col === "holiday_date") state.lte = val;
        const filtered = phs.filter(
          (r) =>
            r.holiday_date >= (state.gte ?? "") &&
            r.holiday_date <= (state.lte ?? ""),
        );
        return Promise.resolve({ data: filtered, error: null });
      }),
    };
    return chain;
  };

  const from = vi.fn((table: string) => {
    if (table === "developers") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: developers, error: null })),
        })),
      };
    }
    if (table === "daily_reports") {
      return {
        select: buildRangeQuery(daily, "report_date", "developer_id"),
      };
    }
    if (table === "weekly_reports") {
      return {
        select: buildRangeQuery(weekly, "week_start_date", "developer_id"),
      };
    }
    if (table === "developer_leave_days") {
      return {
        select: buildRangeQuery(leaves, "leave_date", "developer_id"),
      };
    }
    if (table === "public_holidays") {
      return { select: buildPhQuery() };
    }
    if (table === "monthly_reports") {
      return {
        upsert: vi.fn((row: any, opts: any) => {
          upsertCalls.push({ row, opts });
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { sb: { from } as any, upsertCalls };
}

const validReport: MonthlyReport = {
  developer_handle: "alice",
  month_start_date: MONTH_START,
  summary: "Alice had a strong month.",
  momentum: "accelerating",
  top_themes: ["a", "b", "c"],
  generator_version: "v1+claude-code-headless-monthly",
};

function makeDailyRows(devId: string, dates: string[]): MockDailyRow[] {
  return dates.map((d) => ({
    developer_id: devId,
    report_date: d,
    summary: "day summary",
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

describe("runMonthly", () => {
  it("happy path: dev with 5 days + 2 weeks produces a row", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice Lee" },
      ],
      daily: makeDailyRows("dev-alice", [
        "2026-04-02",
        "2026-04-08",
        "2026-04-15",
        "2026-04-22",
        "2026-04-29",
      ]),
      weekly: [
        {
          developer_id: "dev-alice",
          week_start_date: "2026-03-30",
          summary: "wk1",
          momentum: "steady",
          top_themes: ["t1"],
          parse_failed: false,
        },
        {
          developer_id: "dev-alice",
          week_start_date: "2026-04-13",
          summary: "wk2",
          momentum: "accelerating",
          top_themes: ["t2"],
          parse_failed: false,
        },
      ],
    });
    const analyze = vi.fn(async () => validReport);
    const result = await runMonthly({ sb, analyze, monthStart: MONTH_START });

    expect(result.developers_enumerated).toBe(1);
    expect(result.months_succeeded).toBe(1);
    expect(result.months_failed).toBe(0);
    expect(result.skipped_too_little_data).toBe(0);

    expect(analyze).toHaveBeenCalledOnce();
    const arg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; month_start_date: string; days: any[]; weeks: any[]; total_working_days_in_month: number; total_on_leave_days_in_month: number }])[0];
    expect(arg.developer_handle).toBe("alice");
    expect(arg.display_name).toBe("Alice Lee");
    expect(arg.month_start_date).toBe(MONTH_START);
    expect(arg.days).toHaveLength(5);
    expect(arg.weeks).toHaveLength(2);
    expect(arg.total_working_days_in_month).toBe(22); // April 2026 has 22 weekdays

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.row.summary).toBe("Alice had a strong month.");
    expect(upsertCalls[0]!.row.momentum).toBe("accelerating");
  });

  it("skips dev with fewer than minDays daily rows", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-bob", github_handle: "bob", display_name: "Bob Tan" },
      ],
      daily: makeDailyRows("dev-bob", ["2026-04-02", "2026-04-08"]),
    });
    const analyze = vi.fn();
    const result = await runMonthly({ sb, analyze, monthStart: MONTH_START });
    expect(result.skipped_too_little_data).toBe(1);
    expect(analyze).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it("filters parse_failed daily rows from analyze input", async () => {
    const failed: MockDailyRow = {
      developer_id: "dev-alice",
      report_date: "2026-04-05",
      summary: null,
      trajectory: null,
      metrics: null,
      parse_failed: true,
    };
    const { sb } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice" },
      ],
      daily: [
        ...makeDailyRows("dev-alice", ["2026-04-02", "2026-04-08", "2026-04-15"]),
        failed,
      ],
    });
    const analyze = vi.fn(async () => validReport);
    await runMonthly({ sb, analyze, monthStart: MONTH_START });
    const arg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; month_start_date: string; days: any[]; weeks: any[]; total_working_days_in_month: number; total_on_leave_days_in_month: number }])[0];
    expect(arg.days).toHaveLength(3);
    expect(arg.days.every((d: any) => !d.parse_failed)).toBe(true);
  });

  it("excludes PH dates from working_days_in_month", async () => {
    const { sb } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice" },
      ],
      daily: makeDailyRows("dev-alice", [
        "2026-04-02",
        "2026-04-08",
        "2026-04-15",
      ]),
      publicHolidays: [
        { holiday_date: "2026-04-10" }, // Friday — would normally be a weekday
        { holiday_date: "2026-04-13" }, // Monday
      ],
    });
    const analyze = vi.fn(async () => validReport);
    await runMonthly({ sb, analyze, monthStart: MONTH_START });
    const arg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; month_start_date: string; days: any[]; weeks: any[]; total_working_days_in_month: number; total_on_leave_days_in_month: number }])[0];
    expect(arg.total_working_days_in_month).toBe(20); // 22 weekdays - 2 weekday PHs
  });

  it("counts half-day leaves as 0.5", async () => {
    const { sb } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice" },
      ],
      daily: makeDailyRows("dev-alice", [
        "2026-04-02",
        "2026-04-08",
        "2026-04-15",
      ]),
      leaves: [
        { developer_id: "dev-alice", leave_date: "2026-04-10", is_half_day: false },
        { developer_id: "dev-alice", leave_date: "2026-04-17", is_half_day: true },
      ],
    });
    const analyze = vi.fn(async () => validReport);
    await runMonthly({ sb, analyze, monthStart: MONTH_START });
    const arg = (analyze.mock.calls[0] as unknown as [{ developer_handle: string; display_name?: string; month_start_date: string; days: any[]; weeks: any[]; total_working_days_in_month: number; total_on_leave_days_in_month: number }])[0];
    expect(arg.total_on_leave_days_in_month).toBe(1.5);
  });

  it("upserts parse_failed=true when analyze returns failure", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice" },
      ],
      daily: makeDailyRows("dev-alice", [
        "2026-04-02",
        "2026-04-08",
        "2026-04-15",
      ]),
    });
    const analyze = vi.fn(async () => ({
      parse_failed: true as const,
      error_msg: "boom",
      developer_handle: "alice",
      month_start_date: MONTH_START,
    }));
    const result = await runMonthly({ sb, analyze, monthStart: MONTH_START });
    expect(result.months_failed).toBe(1);
    expect(upsertCalls[0]!.row.parse_failed).toBe(true);
    expect(upsertCalls[0]!.row.error_msg).toBe("boom");
    expect(upsertCalls[0]!.row.summary).toBeNull();
  });

  it("throw safety: analyze throws — counted as failure, loop continues", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", display_name: "Alice" },
        { id: "dev-bob", github_handle: "bob", display_name: "Bob" },
      ],
      daily: [
        ...makeDailyRows("dev-alice", ["2026-04-02", "2026-04-08", "2026-04-15"]),
        ...makeDailyRows("dev-bob", ["2026-04-02", "2026-04-08", "2026-04-15"]),
      ],
    });
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ...validReport, developer_handle: "bob" });
    const result = await runMonthly({ sb, analyze, monthStart: MONTH_START });
    expect(result.months_succeeded).toBe(1);
    expect(result.months_failed).toBe(1);
    expect(upsertCalls).toHaveLength(2);
    const aliceUpsert = upsertCalls.find((u) => u.row.developer_id === "dev-alice");
    expect(aliceUpsert?.row.parse_failed).toBe(true);
  });
});
