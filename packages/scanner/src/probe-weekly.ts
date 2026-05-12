// Tone-validation probe for the weekly analyzer — runs the new buildWeeklyPrompt
// on a hand-picked subset of developers without upserting. Use during prompt
// iteration to inspect the weekly summary + momentum + top_themes output.
//
// Usage: pnpm scanner:probe-weekly <weekStart-YYYY-MM-DD> <handle1> [<handle2> ...]
//   e.g. pnpm scanner:probe-weekly 2026-05-11 naznajmuddin nuraddlynn

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@team-dashboard/shared";
import {
  analyzeDevWeek,
  type AnalyzeWeeklyInput,
} from "./analyze-weekly.js";

function shiftKlDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: tsx src/probe-weekly.ts <weekStart-YYYY-MM-DD> <handle1> [<handle2> ...]",
    );
    process.exit(1);
  }
  const weekStart = args[0]!;
  const targetHandles = args.slice(1);
  const weekEnd = shiftKlDate(weekStart, 6);

  console.error(
    `Probing weekly tone for week ${weekStart} → ${weekEnd}, devs: ${targetHandles.join(", ")}`,
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
      console.log(`\n=== ${handle} — daily_reports query error: ${dailyRes.error.message} ===\n`);
      continue;
    }

    const allDays = (dailyRes.data ?? []) as any[];
    const usableDays = allDays.filter((r) => !r.parse_failed);

    if (usableDays.length === 0) {
      console.log(`\n=== ${handle} — NO USABLE DAILY ROWS in [${weekStart}, ${weekEnd}] ===\n`);
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

    console.error(
      `\nAnalyzing ${handle} (display=${dev.display_name ?? "n/a"}, days=${usableDays.length}) ...`,
    );
    const t0 = Date.now();
    const result = await analyzeDevWeek(input);
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
  console.error("probe-weekly failed:", err);
  process.exit(1);
});
