import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Octokit } from "@octokit/rest";
import { loadEnv, createGitHubClient } from "@team-dashboard/shared";
import { computeTestDiscipline } from "./quality/test-discipline.js";
import { getDiffBetweenCommits } from "./diff.js";
import {
  analyzeDevQuality,
  type AnalyzeQualityBranch,
  type AnalyzeQualityResult,
} from "./analyze-quality.js";

// Phase 2 quality job. Mirrors run-weekly's shape: enumerate active developers,
// read their work for the ISO week (KL Monday-Sunday), compute each quality
// signal, and upsert one weekly_quality_reports row per developer.
//
// Two layers:
//  - Test Discipline (deterministic) — computed from files_touched, no IO.
//  - Code Care / Clarity / Stability + the weekly headline (AI) — one Opus pass
//    per developer that reads their week's diffs. Injected as `deps.qualityAi`
//    so unit tests can run the deterministic layer alone; main() wires the real
//    octokit-backed gatherer below.
const SCANNER_VERSION = "v2+quality-ai";

const MAX_BRANCHES_PER_DEV = Number(
  process.env.QUALITY_MAX_BRANCHES_PER_DEV ?? "6",
);
const MAX_TOTAL_DIFF_CHARS = Number(
  process.env.QUALITY_MAX_TOTAL_DIFF_CHARS ?? "60000",
);

interface DevRow {
  id: string;
  github_handle: string;
  display_name: string | null;
  level: string | null;
}

interface BranchRow {
  files_touched: string[] | null;
  last_commit_at: string | null;
  repo_full_name?: string | null;
  branch_name?: string | null;
  head_sha?: string | null;
  base_sha?: string | null;
}

/** Per-dev AI pass. Returns the AI report (or a parse failure) for one dev's
 *  week. Injected so the deterministic layer is testable without GitHub/Opus. */
export type QualityAiFn = (
  dev: DevRow,
  branches: BranchRow[],
  weekStart: string,
) => Promise<AnalyzeQualityResult>;

export interface RunQualityDeps {
  sb: SupabaseClient;
  /** Monday YYYY-MM-DD KL — defaults to last completed Monday. */
  weekStart?: string;
  /** Optional AI pass. Omit to write only Test Discipline (unit tests). */
  qualityAi?: QualityAiFn;
}

export interface RunQualityResult {
  developers: number;
  succeeded: number;
  failed: number;
}

function shiftKlDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split("T")[0]!;
}

function lastCompletedMondayKl(now: Date): string {
  const klNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const klDay = klNow.toISOString().split("T")[0]!;
  const [y, m, d] = klDay.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const stepBackToCurrentMonday = (dayOfWeek + 6) % 7; // Mon=0, ..., Sun=6
  const lastCompletedShift = -stepBackToCurrentMonday - 7;
  return shiftKlDate(klDay, lastCompletedShift);
}

function klWeekBoundsUtc(weekStart: string): { gte: string; lt: string } {
  const [y, m, d] = weekStart.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const startUtc = new Date(Date.UTC(y, m - 1, d, -8, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 7 * 24 * 3600 * 1000);
  return { gte: startUtc.toISOString(), lt: endUtc.toISOString() };
}

/** Concatenate a diff snapshot's file patches into one prompt-ready blob
 *  (mirrors run-daily's buildDiffText). */
function buildDiffText(
  files: { filename: string; patch: string }[],
): string {
  return files.map((f) => `--- ${f.filename}\n${f.patch}`).join("\n\n");
}

/** The real AI gatherer: re-fetch each in-window branch's diff + commit
 *  subjects from GitHub, cap the budget, and run the Opus quality pass. */
export function makeQualityAi(octokit: Octokit): QualityAiFn {
  return async (dev, branches, weekStart) => {
    const usable = branches
      .filter((b) => b.head_sha && b.base_sha && b.repo_full_name)
      .slice(0, MAX_BRANCHES_PER_DEV);

    const aiBranches: AnalyzeQualityBranch[] = [];
    let totalDiff = 0;
    for (const b of usable) {
      let snapshot;
      try {
        snapshot = await getDiffBetweenCommits(
          octokit,
          b.repo_full_name!,
          b.base_sha!,
          b.head_sha!,
        );
      } catch (err) {
        // A single unfetchable branch (force-push, deleted base) shouldn't sink
        // the dev's whole quality read — skip it and judge from the rest.
        console.error(
          `quality diff fetch failed for ${dev.github_handle} ${b.repo_full_name}#${b.branch_name}: ${(err as Error).message}`,
        );
        continue;
      }
      let diff = buildDiffText(snapshot.files);
      if (totalDiff + diff.length > MAX_TOTAL_DIFF_CHARS) {
        diff = diff.slice(0, Math.max(0, MAX_TOTAL_DIFF_CHARS - totalDiff));
      }
      totalDiff += diff.length;
      aiBranches.push({
        branch_name: b.branch_name ?? "(unknown)",
        repo_full_name: b.repo_full_name!,
        head_sha: b.head_sha!,
        base_sha: b.base_sha!,
        diff_text: diff,
        commit_subjects: snapshot.commits.map(
          (c) => c.message.split("\n")[0] ?? "",
        ),
      });
    }

    return analyzeDevQuality({
      developer_handle: dev.github_handle,
      week_start_date: weekStart,
      display_name: dev.display_name ?? undefined,
      level: dev.level,
      branches: aiBranches,
    });
  };
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

  const devRes = await sb
    .from("developers")
    .select("id, github_handle, display_name, level")
    .eq("active", true);
  if (devRes.error) {
    throw new Error(`developers query failed: ${devRes.error.message}`);
  }
  const developers = (devRes.data ?? []) as DevRow[];
  counters.developers = developers.length;

  for (const dev of developers) {
    const branchRes = await sb
      .from("developer_active_branches")
      .select(
        "files_touched, last_commit_at, repo_full_name, branch_name, head_sha, base_sha",
      )
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

    // AI layer (optional). A parse failure still lets the deterministic Test
    // Discipline row land — we record the error and leave the AI bands null.
    let aiFields: Record<string, unknown> = {};
    if (deps.qualityAi) {
      const ai = await deps.qualityAi(dev, branches, weekStart);
      if ("parse_failed" in ai) {
        aiFields = { error_msg: ai.error_msg };
      } else {
        aiFields = {
          code_care_band: ai.code_care_band,
          code_care_evidence: ai.code_care_evidence,
          clarity_band: ai.clarity_band,
          clarity_evidence: ai.clarity_evidence,
          stability_band: ai.stability_band,
          stability_evidence: ai.stability_evidence,
          headline: ai.headline,
          needs_a_chat: ai.needs_a_chat,
        };
      }
    }

    const upsertRes = await sb.from("weekly_quality_reports").upsert(
      {
        developer_id: dev.id,
        week_start_date: weekStart,
        test_discipline_band: testDiscipline.band,
        test_discipline_evidence: testDiscipline.evidence,
        level_snapshot: dev.level,
        scanner_version: SCANNER_VERSION,
        ...aiFields,
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
  // QUALITY_SKIP_AI=1 runs the deterministic Test Discipline layer only (no Opus).
  const qualityAi =
    process.env.QUALITY_SKIP_AI === "1"
      ? undefined
      : makeQualityAi(createGitHubClient());

  const result = await runQuality({ sb, weekStart, qualityAi });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("run-quality failed:", err);
    process.exit(1);
  });
}
