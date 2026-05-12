import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@team-dashboard/shared";
import type { WeeklyReport, Trajectory, DailyReportMetrics } from "@team-dashboard/shared";
import {
  analyzeDevWeek,
  type AnalyzeWeeklyInput,
  type AnalyzeWeeklyResult,
} from "./analyze-weekly.js";

const DEFAULT_MIN_DAYS = 3;

export interface RunWeeklyDeps {
  sb: SupabaseClient;
  analyze?: (input: AnalyzeWeeklyInput) => Promise<AnalyzeWeeklyResult>;
  /** Monday YYYY-MM-DD KL — defaults to last completed Monday (today's-1 day floored to Monday) */
  weekStart?: string;
  /** minimum non-failed daily rows for a dev to be included; defaults to 3, override to 1 for first-test */
  minDays?: number;
}

export interface RunWeeklyResult {
  developers_enumerated: number;
  weeks_succeeded: number;
  weeks_failed: number;
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

function shiftKlDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

function lastCompletedMondayKl(now: Date): string {
  // KL = UTC+8. Roll the timestamp into KL, get YYYY-MM-DD, then go back to last Monday.
  const klNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const klDay = klNow.toISOString().split("T")[0]!;
  // Compute weekday of klDay in UTC (treating klDay as a UTC midnight)
  const [y, m, d] = klDay.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  // dt.getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat
  const dayOfWeek = dt.getUTCDay();
  // We want the LAST COMPLETED week's Monday. If today is Mon → 7 days back. If today is Tue → 8 days back. ... If today is Sun → 13 days back. Wait that's the prior week's Mon for ALL days. Better: want the Monday of the week ending YESTERDAY.
  // Algorithm: floor today to its current-week Monday (Mon=0 step back; Tue=1; ...; Sun=6), then subtract 7 to get last week's Monday.
  const stepBackToCurrentMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const currentMondayShift = -stepBackToCurrentMonday;
  const lastCompletedShift = currentMondayShift - 7;
  return shiftKlDate(klDay, lastCompletedShift);
}

export async function runWeekly(
  deps: RunWeeklyDeps,
): Promise<RunWeeklyResult> {
  const { sb } = deps;
  const weekStart = deps.weekStart ?? lastCompletedMondayKl(new Date());
  const weekEnd = shiftKlDate(weekStart, 6); // Mon+6 = Sun, inclusive
  const minDays = deps.minDays ?? DEFAULT_MIN_DAYS;
  const analyze = deps.analyze ?? analyzeDevWeek;

  const counters: RunWeeklyResult = {
    developers_enumerated: 0,
    weeks_succeeded: 0,
    weeks_failed: 0,
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

  // 2. Per-dev: pull daily_reports in window, analyze, upsert
  for (const dev of developers) {
    const dailyRes = await sb
      .from("daily_reports")
      .select(
        "developer_id, report_date, summary, trajectory, metrics, parse_failed",
      )
      .eq("developer_id", dev.id)
      .gte("report_date", weekStart)
      .lte("report_date", weekEnd)
      .order("report_date", { ascending: true });
    if (dailyRes.error) {
      console.error(
        `daily_reports query failed for ${dev.github_handle}: ${dailyRes.error.message}`,
      );
      counters.weeks_failed += 1;
      continue;
    }
    const allDays = (dailyRes.data ?? []) as DailyRowFromDb[];
    const usableDays = allDays.filter((r) => !r.parse_failed);

    if (usableDays.length < minDays) {
      counters.skipped_too_little_data += 1;
      continue;
    }

    const input: AnalyzeWeeklyInput = {
      developer_handle: dev.github_handle,
      week_start_date: weekStart,
      display_name: dev.display_name ?? undefined,
      days: usableDays.map((r) => ({
        report_date: r.report_date,
        summary: r.summary,
        trajectory: r.trajectory,
        metrics: r.metrics,
        parse_failed: r.parse_failed,
      })),
    };

    let result: AnalyzeWeeklyResult;
    try {
      result = await analyze(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`analyze threw for ${dev.github_handle}: ${msg}`);
      result = {
        parse_failed: true,
        error_msg: `analyze threw: ${msg}`,
        developer_handle: dev.github_handle,
        week_start_date: weekStart,
      };
    }

    if ("parse_failed" in result && result.parse_failed) {
      const upsertRes = await sb.from("weekly_reports").upsert(
        {
          developer_id: dev.id,
          week_start_date: weekStart,
          summary: null,
          momentum: null,
          top_themes: null,
          generator_version: null,
          parse_failed: true,
          error_msg: result.error_msg,
        },
        { onConflict: "developer_id,week_start_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (parse_failed) for ${dev.github_handle}: ${upsertRes.error.message}`,
        );
      }
      counters.weeks_failed += 1;
    } else {
      const report = result as WeeklyReport;
      const upsertRes = await sb.from("weekly_reports").upsert(
        {
          developer_id: dev.id,
          week_start_date: weekStart,
          summary: report.summary,
          momentum: report.momentum,
          top_themes: report.top_themes,
          generator_version: report.generator_version,
          parse_failed: false,
          error_msg: null,
        },
        { onConflict: "developer_id,week_start_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (success) for ${dev.github_handle}: ${upsertRes.error.message}`,
        );
      }
      counters.weeks_succeeded += 1;
    }
  }

  return counters;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;

  const weekStart = process.env.WEEK_START_OVERRIDE;
  const minDays = process.env.MIN_DAYS_OVERRIDE
    ? Number.parseInt(process.env.MIN_DAYS_OVERRIDE, 10)
    : undefined;

  const result = await runWeekly({ sb, weekStart, minDays });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("run-weekly failed:", err);
    process.exit(1);
  });
}
