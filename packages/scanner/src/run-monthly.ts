import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@team-dashboard/shared";
import type {
  MonthlyReport,
  Trajectory,
  DailyReportMetrics,
  Momentum,
} from "@team-dashboard/shared";
import {
  analyzeDevMonth,
  type AnalyzeMonthlyInput,
  type AnalyzeMonthlyResult,
} from "./analyze-monthly.js";

const DEFAULT_MIN_DAYS = 3;

export interface RunMonthlyDeps {
  sb: SupabaseClient;
  analyze?: (input: AnalyzeMonthlyInput) => Promise<AnalyzeMonthlyResult>;
  /** YYYY-MM-DD first-of-month KL; defaults to first day of last completed month */
  monthStart?: string;
  /** minimum non-failed daily rows for a dev to be included; default 3 */
  minDays?: number;
}

export interface RunMonthlyResult {
  developers_enumerated: number;
  months_succeeded: number;
  months_failed: number;
  skipped_too_little_data: number;
}

interface DevRow {
  id: string;
  github_handle: string;
  display_name: string | null;
}

interface DailyRowFromDb {
  developer_id: string;
  report_date: string;
  summary: string | null;
  trajectory: Trajectory | null;
  metrics: DailyReportMetrics | null;
  parse_failed: boolean;
}

interface WeeklyRowFromDb {
  developer_id: string;
  week_start_date: string;
  summary: string | null;
  momentum: Momentum | null;
  top_themes: string[] | null;
  parse_failed: boolean;
}

interface LeaveDayRow {
  developer_id: string;
  leave_date: string;
  is_half_day: boolean;
}

interface PublicHolidayRow {
  holiday_date: string;
}

function shiftKlDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

function lastCompletedMonthStartKl(now: Date): string {
  const klNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = klNow.getUTCFullYear();
  const m = klNow.getUTCMonth(); // 0-11
  // Last completed month = previous calendar month relative to "today" in KL
  // Edge: in early Jan, that's Dec of previous year
  const prevYear = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 11 : m - 1;
  // Format YYYY-MM-01
  return `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  // First day of next month, minus 1 day
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const firstOfNext = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return shiftKlDate(firstOfNext, -1);
}

export async function runMonthly(
  deps: RunMonthlyDeps,
): Promise<RunMonthlyResult> {
  const { sb } = deps;
  const monthStart = deps.monthStart ?? lastCompletedMonthStartKl(new Date());
  const monthEnd = lastDayOfMonth(monthStart);
  const minDays = deps.minDays ?? DEFAULT_MIN_DAYS;
  const analyze = deps.analyze ?? analyzeDevMonth;

  const counters: RunMonthlyResult = {
    developers_enumerated: 0,
    months_succeeded: 0,
    months_failed: 0,
    skipped_too_little_data: 0,
  };

  // 1. Enumerate active developers
  const devRes = await sb
    .from("developers")
    .select("id, github_handle, display_name")
    .eq("active", true);
  if (devRes.error) {
    throw new Error(`developers query failed: ${devRes.error.message}`);
  }
  const developers = (devRes.data ?? []) as DevRow[];
  counters.developers_enumerated = developers.length;

  // 2. Bulk-fetch all month-scoped data once
  const devIds = developers.map((d) => d.id);
  if (devIds.length === 0) return counters;

  const [dailyRes, weeklyRes, leaveRes, holidayRes] = await Promise.all([
    sb
      .from("daily_reports")
      .select(
        "developer_id, report_date, summary, trajectory, metrics, parse_failed",
      )
      .in("developer_id", devIds)
      .gte("report_date", monthStart)
      .lte("report_date", monthEnd),
    sb
      .from("weekly_reports")
      .select(
        "developer_id, week_start_date, summary, momentum, top_themes, parse_failed",
      )
      .in("developer_id", devIds)
      // Pull weeks whose Monday is at-or-after (monthStart - 6 days), since a
      // week starting that early can still contain a day inside the month.
      .gte("week_start_date", shiftKlDate(monthStart, -6))
      .lte("week_start_date", monthEnd),
    sb
      .from("developer_leave_days")
      .select("developer_id, leave_date, is_half_day")
      .in("developer_id", devIds)
      .gte("leave_date", monthStart)
      .lte("leave_date", monthEnd),
    sb
      .from("public_holidays")
      .select("holiday_date")
      .eq("state", "KL")
      .gte("holiday_date", monthStart)
      .lte("holiday_date", monthEnd),
  ]);

  if (dailyRes.error) throw new Error(`daily_reports: ${dailyRes.error.message}`);
  if (weeklyRes.error) throw new Error(`weekly_reports: ${weeklyRes.error.message}`);
  if (leaveRes.error) throw new Error(`leave: ${leaveRes.error.message}`);
  if (holidayRes.error) throw new Error(`public_holidays: ${holidayRes.error.message}`);

  const dailyByDev = new Map<string, DailyRowFromDb[]>();
  for (const r of (dailyRes.data ?? []) as DailyRowFromDb[]) {
    const arr = dailyByDev.get(r.developer_id) ?? [];
    arr.push(r);
    dailyByDev.set(r.developer_id, arr);
  }
  const weeklyByDev = new Map<string, WeeklyRowFromDb[]>();
  for (const r of (weeklyRes.data ?? []) as WeeklyRowFromDb[]) {
    const arr = weeklyByDev.get(r.developer_id) ?? [];
    arr.push(r);
    weeklyByDev.set(r.developer_id, arr);
  }
  const leaveByDev = new Map<string, LeaveDayRow[]>();
  for (const r of (leaveRes.data ?? []) as LeaveDayRow[]) {
    const arr = leaveByDev.get(r.developer_id) ?? [];
    arr.push(r);
    leaveByDev.set(r.developer_id, arr);
  }
  const phDates = new Set<string>(
    ((holidayRes.data ?? []) as PublicHolidayRow[]).map((r) => r.holiday_date),
  );

  // Working days in month (weekdays minus public holidays)
  const totalWorkingDaysInMonth = computeWorkingDays(monthStart, monthEnd, phDates);

  // 3. Per developer: aggregate and analyze
  for (const dev of developers) {
    const dailyRows = (dailyByDev.get(dev.id) ?? []).sort((a, b) =>
      a.report_date.localeCompare(b.report_date),
    );
    const usableDays = dailyRows.filter((r) => !r.parse_failed);

    if (usableDays.length < minDays) {
      counters.skipped_too_little_data += 1;
      continue;
    }

    const weeklyRows = (weeklyByDev.get(dev.id) ?? [])
      .filter((r) => !r.parse_failed)
      .sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));

    const leaveRows = leaveByDev.get(dev.id) ?? [];
    const onLeaveDays = leaveRows.reduce(
      (sum, r) => sum + (r.is_half_day ? 0.5 : 1),
      0,
    );

    const input: AnalyzeMonthlyInput = {
      developer_handle: dev.github_handle,
      month_start_date: monthStart,
      display_name: dev.display_name ?? undefined,
      days: usableDays.map((r) => ({
        report_date: r.report_date,
        summary: r.summary,
        trajectory: r.trajectory,
        metrics: r.metrics,
        parse_failed: r.parse_failed,
      })),
      weeks: weeklyRows.map((r) => ({
        week_start_date: r.week_start_date,
        summary: r.summary,
        momentum: r.momentum,
        top_themes: r.top_themes,
      })),
      total_working_days_in_month: totalWorkingDaysInMonth,
      total_on_leave_days_in_month: onLeaveDays,
    };

    let result: AnalyzeMonthlyResult;
    try {
      result = await analyze(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`analyze threw for ${dev.github_handle}: ${msg}`);
      result = {
        parse_failed: true,
        error_msg: `analyze threw: ${msg}`,
        developer_handle: dev.github_handle,
        month_start_date: monthStart,
      };
    }

    if ("parse_failed" in result && result.parse_failed) {
      const upsertRes = await sb.from("monthly_reports").upsert(
        {
          developer_id: dev.id,
          month_start_date: monthStart,
          summary: null,
          momentum: null,
          top_themes: null,
          generator_version: null,
          parse_failed: true,
          error_msg: result.error_msg,
        },
        { onConflict: "developer_id,month_start_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (parse_failed) for ${dev.github_handle}: ${upsertRes.error.message}`,
        );
      }
      counters.months_failed += 1;
    } else {
      const report = result as MonthlyReport;
      const upsertRes = await sb.from("monthly_reports").upsert(
        {
          developer_id: dev.id,
          month_start_date: monthStart,
          summary: report.summary,
          momentum: report.momentum,
          top_themes: report.top_themes,
          generator_version: report.generator_version,
          parse_failed: false,
          error_msg: null,
        },
        { onConflict: "developer_id,month_start_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (success) for ${dev.github_handle}: ${upsertRes.error.message}`,
        );
      }
      counters.months_succeeded += 1;
    }
  }

  return counters;
}

function computeWorkingDays(
  monthStart: string,
  monthEnd: string,
  phDates: Set<string>,
): number {
  let cur = monthStart;
  let count = 0;
  while (cur <= monthEnd) {
    const [y, m, d] = cur.split("-").map(Number) as [number, number, number];
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6 && !phDates.has(cur)) count++;
    cur = shiftKlDate(cur, 1);
  }
  return count;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;

  const monthStart = process.env.MONTH_START_OVERRIDE;
  const minDays = process.env.MIN_DAYS_OVERRIDE
    ? Number.parseInt(process.env.MIN_DAYS_OVERRIDE, 10)
    : undefined;

  const result = await runMonthly({ sb, monthStart, minDays });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("run-monthly failed:", err);
    process.exit(1);
  });
}
