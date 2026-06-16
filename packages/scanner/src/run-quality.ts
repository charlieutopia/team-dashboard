import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "@team-dashboard/shared";
import { computeTestDiscipline } from "./quality/test-discipline.js";

// Phase 2 quality job. Mirrors run-weekly's shape: enumerate active developers,
// read their work for the ISO week (KL Monday-Sunday), compute each quality
// signal, and upsert one weekly_quality_reports row per developer.
//
// This build ships ONLY the Test Discipline dimension. Stability, code care,
// review citizenship, and clarity are left null — they fill in later builds.
const SCANNER_VERSION = "v1+quality-test-discipline";

export interface RunQualityDeps {
  sb: SupabaseClient;
  /** Monday YYYY-MM-DD KL — defaults to last completed Monday. */
  weekStart?: string;
}

export interface RunQualityResult {
  developers: number;
  succeeded: number;
  failed: number;
}

interface DevRow {
  id: string;
  github_handle: string;
  level: string | null;
}

interface BranchRow {
  files_touched: string[] | null;
  last_commit_at: string | null;
}

function shiftKlDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

function lastCompletedMondayKl(now: Date): string {
  // KL = UTC+8. Roll the timestamp into KL, get YYYY-MM-DD, then go back to the
  // Monday of the last COMPLETED week (same algorithm as run-weekly).
  const klNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const klDay = klNow.toISOString().split("T")[0]!;
  const [y, m, d] = klDay.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const stepBackToCurrentMonday = (dayOfWeek + 6) % 7; // Mon=0, ..., Sun=6
  const lastCompletedShift = -stepBackToCurrentMonday - 7;
  return shiftKlDate(klDay, lastCompletedShift);
}

// The KL week window as half-open UTC instants. weekStart is a KL Monday
// (00:00 KL = the prior day 16:00 UTC). The window spans 7 KL days, so the
// exclusive upper bound is the NEXT Monday 00:00 KL.
function klWeekBoundsUtc(weekStart: string): { gte: string; lt: string } {
  const [y, m, d] = weekStart.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  // 00:00 KL == 16:00 UTC on the previous calendar day.
  const startUtc = new Date(Date.UTC(y, m - 1, d, -8, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 7 * 24 * 3600 * 1000);
  return { gte: startUtc.toISOString(), lt: endUtc.toISOString() };
}

export async function runQuality(
  deps: RunQualityDeps,
): Promise<RunQualityResult> {
  const { sb } = deps;
  const weekStart = deps.weekStart ?? lastCompletedMondayKl(new Date());
  const { gte, lt } = klWeekBoundsUtc(weekStart);

  const counters: RunQualityResult = {
    developers: 0,
    succeeded: 0,
    failed: 0,
  };

  // 1. Enumerate active developers.
  const devRes = await sb
    .from("developers")
    .select("id, github_handle, level")
    .eq("active", true);
  if (devRes.error) {
    throw new Error(`developers query failed: ${devRes.error.message}`);
  }
  const developers = (devRes.data ?? []) as DevRow[];
  counters.developers = developers.length;

  // 2. Per-dev: read their active branches whose last commit falls in the week
  // window, compute test discipline, and upsert the quality report row.
  for (const dev of developers) {
    const branchRes = await sb
      .from("developer_active_branches")
      .select("files_touched, last_commit_at")
      .eq("developer_id", dev.id)
      .gte("last_commit_at", gte)
      .lt("last_commit_at", lt);
    if (branchRes.error) {
      console.error(
        `developer_active_branches query failed for ${dev.github_handle}: ${branchRes.error.message}`,
      );
      counters.failed += 1;
      continue;
    }
    const branches = (branchRes.data ?? []) as BranchRow[];

    const testDiscipline = computeTestDiscipline(
      branches.map((b) => ({ files_touched: b.files_touched ?? [] })),
    );

    const upsertRes = await sb.from("weekly_quality_reports").upsert(
      {
        developer_id: dev.id,
        week_start_date: weekStart,
        test_discipline_band: testDiscipline.band,
        test_discipline_evidence: testDiscipline.evidence,
        level_snapshot: dev.level,
        scanner_version: SCANNER_VERSION,
      },
      { onConflict: "developer_id,week_start_date" },
    );
    if (upsertRes.error) {
      console.error(
        `weekly_quality_reports upsert failed for ${dev.github_handle}: ${upsertRes.error.message}`,
      );
      counters.failed += 1;
      continue;
    }
    counters.succeeded += 1;
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

  const result = await runQuality({ sb, weekStart });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("run-quality failed:", err);
    process.exit(1);
  });
}
