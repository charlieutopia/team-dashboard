// Tone-validation probe for the monthly analyzer. Read-only — runs the new
// buildMonthlyPrompt on a hand-picked subset of developers without upserting.
//
// Usage: pnpm scanner:probe-monthly <monthStart-YYYY-MM-DD> <handle1> [<handle2> ...]
//   e.g. pnpm scanner:probe-monthly 2026-05-01 naznajmuddin nuraddlynn

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@team-dashboard/shared";
import {
  analyzeDevMonth,
  type AnalyzeMonthlyInput,
} from "./analyze-monthly.js";

function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

function lastDayOfMonth(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return shiftDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`, -1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: tsx src/probe-monthly.ts <monthStart-YYYY-MM-DD> <handle1> [<handle2> ...]",
    );
    process.exit(1);
  }
  const monthStart = args[0]!;
  const targetHandles = args.slice(1);
  const monthEnd = lastDayOfMonth(monthStart);

  console.error(
    `Probing monthly tone for month ${monthStart} → ${monthEnd}, devs: ${targetHandles.join(", ")}`,
  );

  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;

  for (const handle of targetHandles) {
    const devRes = await sb
      .from("developers")
      .select("id, github_handle, display_name")
      .eq("github_handle", handle)
      .maybeSingle();
    const dev = devRes.data as
      | { id: string; github_handle: string; display_name: string | null }
      | null;
    if (!dev) {
      console.log(`\n=== ${handle} — NOT IN developers TABLE ===\n`);
      continue;
    }

    const [dailyRes, weeklyRes, leaveRes, phRes] = await Promise.all([
      sb
        .from("daily_reports")
        .select(
          "report_date, summary, trajectory, metrics, parse_failed",
        )
        .eq("developer_id", dev.id)
        .gte("report_date", monthStart)
        .lte("report_date", monthEnd)
        .order("report_date", { ascending: true }),
      sb
        .from("weekly_reports")
        .select(
          "week_start_date, summary, momentum, top_themes, parse_failed",
        )
        .eq("developer_id", dev.id)
        .gte("week_start_date", shiftDate(monthStart, -6))
        .lte("week_start_date", monthEnd)
        .order("week_start_date", { ascending: true }),
      sb
        .from("developer_leave_days")
        .select("leave_date, is_half_day")
        .eq("developer_id", dev.id)
        .gte("leave_date", monthStart)
        .lte("leave_date", monthEnd),
      sb
        .from("public_holidays")
        .select("holiday_date")
        .eq("state", "KL")
        .gte("holiday_date", monthStart)
        .lte("holiday_date", monthEnd),
    ]);

    if (dailyRes.error || weeklyRes.error || leaveRes.error || phRes.error) {
      console.log(`\n=== ${handle} — query error ===`);
      continue;
    }

    const usableDays = (dailyRes.data ?? []).filter((r: any) => !r.parse_failed);
    if (usableDays.length === 0) {
      console.log(`\n=== ${handle} — NO USABLE DAILY ROWS in [${monthStart}, ${monthEnd}] ===\n`);
      continue;
    }

    const phDates = new Set((phRes.data ?? []).map((r: any) => r.holiday_date));
    let cur = monthStart;
    let workingDays = 0;
    while (cur <= monthEnd) {
      const [y, m, d] = cur.split("-").map(Number) as [number, number, number];
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (dow !== 0 && dow !== 6 && !phDates.has(cur)) workingDays++;
      cur = shiftDate(cur, 1);
    }

    const leaves = leaveRes.data ?? [];
    const onLeaveDays = leaves.reduce(
      (sum: number, r: any) => sum + (r.is_half_day ? 0.5 : 1),
      0,
    );

    const input: AnalyzeMonthlyInput = {
      developer_handle: dev.github_handle,
      month_start_date: monthStart,
      display_name: dev.display_name ?? undefined,
      days: usableDays.map((r: any) => ({
        report_date: r.report_date,
        summary: r.summary,
        trajectory: r.trajectory,
        metrics: r.metrics,
        parse_failed: r.parse_failed,
      })),
      weeks: (weeklyRes.data ?? [])
        .filter((r: any) => !r.parse_failed)
        .map((r: any) => ({
          week_start_date: r.week_start_date,
          summary: r.summary,
          momentum: r.momentum,
          top_themes: r.top_themes,
        })),
      total_working_days_in_month: workingDays,
      total_on_leave_days_in_month: onLeaveDays,
    };

    console.error(
      `\nAnalyzing ${handle} (display=${dev.display_name ?? "n/a"}, days=${usableDays.length}, weeks=${input.weeks.length}) ...`,
    );
    const t0 = Date.now();
    const result = await analyzeDevMonth(input);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n=== ${handle} (${elapsed}s) ===`);
    if ("parse_failed" in result && result.parse_failed) {
      console.log(`FAILED: ${result.error_msg}`);
      continue;
    }
    const r = result as Exclude<typeof result, { parse_failed: true }>;
    const wc = r.summary.trim().split(/\s+/).filter(Boolean).length;
    console.log(`momentum: ${r.momentum}`);
    console.log(`top_themes: ${JSON.stringify(r.top_themes)}`);
    console.log(`word count: ${wc}`);
    console.log(`summary:\n${r.summary}`);
  }
}

main().catch((err) => {
  console.error("probe-monthly failed:", err);
  process.exit(1);
});
