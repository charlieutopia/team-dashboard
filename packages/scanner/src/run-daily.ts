import type { SupabaseClient } from "@supabase/supabase-js";
import type { Octokit } from "@octokit/rest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, createGitHubClient } from "@team-dashboard/shared";
import type { DailyReport } from "@team-dashboard/shared";
import { enumerateActiveBranches } from "./enumerate.js";
import { getDiffBetweenCommits } from "./diff.js";
import { getSpecForModule } from "./spec.js";
import { analyzeDevDay, type AnalyzeInput, type AnalyzeResult } from "./analyze.js";

export interface RunDailyDeps {
  sb: SupabaseClient;
  octokit: Octokit;
  /** override for tests; default uses real analyzeDevDay */
  analyze?: (
    input: AnalyzeInput,
  ) => Promise<AnalyzeResult>;
  /** the cron run's KL date YYYY-MM-DD; default computed from `now` */
  klDate?: string;
}

export interface RunDailyResult {
  developers_analyzed: number;
  reports_succeeded: number;
  reports_failed: number;
  skipped_no_developer: number;
}

interface BranchPayload {
  branch_name: string;
  head_sha: string;
  base_sha: string;
  diff_text: string;
}

interface TrackedRepoRow {
  id: string;
  full_name: string;
  spec_module: string;
}

function computeKlDate(now: Date): string {
  // KL is UTC+8
  return new Date(now.getTime() + 8 * 3600 * 1000)
    .toISOString()
    .split("T")[0]!;
}

// Per-branch diff cap. Empirical from Phase 2.A Step 7: devs with multi-branch
// large-diff payloads pushed prompts past the model's effective context (200K
// tokens) and the CLI exited 1 with no stderr. Capping at 30KB per branch
// (~7500 tokens) keeps even 5-branch devs comfortably under context.
const MAX_DIFF_TEXT_BYTES_PER_BRANCH = 30_000;

function buildDiffText(files: { filename: string; patch: string }[]): string {
  const full = files.map((f) => `--- ${f.filename}\n${f.patch}`).join("\n\n");
  const fullBytes = Buffer.byteLength(full, "utf8");
  if (fullBytes <= MAX_DIFF_TEXT_BYTES_PER_BRANCH) return full;
  const truncated = full.slice(0, MAX_DIFF_TEXT_BYTES_PER_BRANCH);
  return (
    truncated +
    `\n\n[... TRUNCATED — original ${fullBytes} bytes, kept first ${MAX_DIFF_TEXT_BYTES_PER_BRANCH} ...]`
  );
}

export async function runDaily(deps: RunDailyDeps): Promise<RunDailyResult> {
  const { sb, octokit } = deps;
  const klDate = deps.klDate ?? computeKlDate(new Date());
  const analyze = deps.analyze ?? analyzeDevDay;

  const counters: RunDailyResult = {
    developers_analyzed: 0,
    reports_succeeded: 0,
    reports_failed: 0,
    skipped_no_developer: 0,
  };

  // 1. Read tracked repos
  const trackedRes = await sb
    .from("tracked_repos")
    .select("id, full_name, spec_module")
    .eq("active", true);
  if (trackedRes.error) {
    throw new Error(`tracked_repos query failed: ${trackedRes.error.message}`);
  }
  const trackedRepos = (trackedRes.data ?? []) as TrackedRepoRow[];
  if (trackedRepos.length === 0) {
    return counters;
  }

  // TODO(multi-repo): if a developer has branches across multiple repos in the
  // same day, group by (repo_id, handle) and emit one analyzeDevDay call per
  // (repo, dev) pair. For Phase 2.A only utopiaspace is tracked, so we group
  // by handle and assume single-repo per dev.
  const branchesByHandle = new Map<string, BranchPayload[]>();
  let primaryRepoFullName = trackedRepos[0]!.full_name;
  let primaryRepoSpec = "";

  for (const repo of trackedRepos) {
    const branches = await enumerateActiveBranches(octokit, repo.full_name);
    if (branches.length === 0) {
      continue;
    }

    // Spec text fetched once per repo (currently unused beyond first repo,
    // see TODO above).
    const specText = await getSpecForModule(octokit, repo.spec_module);

    const [owner, repoName] = repo.full_name.split("/");
    if (!owner || !repoName) {
      throw new Error(`invalid repo full_name: ${repo.full_name}`);
    }
    const repoMeta = await octokit.repos.get({ owner, repo: repoName });
    const defaultBranch = repoMeta.data.default_branch;
    const defaultBranchData = await octokit.repos.getBranch({
      owner,
      repo: repoName,
      branch: defaultBranch,
    });
    const baseSha = defaultBranchData.data.commit.sha;
    primaryRepoFullName = repo.full_name;

    for (const branch of branches) {
      const snapshot = await getDiffBetweenCommits(
        octokit,
        repo.full_name,
        baseSha,
        branch.head_sha,
      );
      const lastCommit = snapshot.commits[snapshot.commits.length - 1];
      const handle = lastCommit?.author_login ?? null;
      if (!handle) {
        // No author we can attribute to — skip.
        continue;
      }
      const payload: BranchPayload = {
        branch_name: branch.branch_name,
        head_sha: branch.head_sha,
        base_sha: baseSha,
        diff_text: buildDiffText(snapshot.files),
      };
      const existing = branchesByHandle.get(handle);
      if (existing) {
        existing.push(payload);
      } else {
        branchesByHandle.set(handle, [payload]);
      }
    }

    // Stash spec for the loop below — single-repo case keeps it simple.
    primaryRepoSpec = specText;
  }

  // 5. Resolve developer ids; skip handles with no row.
  interface ResolvedDev {
    handle: string;
    developer_id: string;
    display_name: string | null;
    branches: BranchPayload[];
  }
  const resolved: ResolvedDev[] = [];
  for (const [handle, branches] of branchesByHandle) {
    const devRes = await sb
      .from("developers")
      .select("id, display_name")
      .eq("github_handle", handle)
      .maybeSingle();
    if (devRes.error) {
      throw new Error(
        `developers query failed for ${handle}: ${devRes.error.message}`,
      );
    }
    const row = devRes.data as { id: string; display_name: string | null } | null;
    if (!row) {
      console.log(`skip ${handle}: not in developers table`);
      counters.skipped_no_developer += 1;
      continue;
    }
    resolved.push({
      handle,
      developer_id: row.id,
      display_name: row.display_name,
      branches,
    });
  }

  // 6. Serial analyze + upsert loop.
  for (const dev of resolved) {
    counters.developers_analyzed += 1;
    let result: AnalyzeResult;
    try {
      result = await analyze({
        developer_handle: dev.handle,
        date: klDate,
        repo_full_name: primaryRepoFullName,
        branches: dev.branches,
        spec_text: primaryRepoSpec,
        display_name: dev.display_name ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`analyze threw for ${dev.handle}: ${msg}`);
      result = {
        parse_failed: true,
        error_msg: `analyze threw: ${msg}`,
        developer_handle: dev.handle,
        date: klDate,
      };
    }

    if ("parse_failed" in result && result.parse_failed) {
      const upsertRes = await sb.from("daily_reports").upsert(
        {
          developer_id: dev.developer_id,
          report_date: klDate,
          summary: null,
          metrics: null,
          spec_progress: null,
          trajectory: null,
          generator_version: null,
          parse_failed: true,
          error_msg: result.error_msg,
        },
        { onConflict: "developer_id,report_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (parse_failed) for ${dev.handle}: ${upsertRes.error.message}`,
        );
      }
      counters.reports_failed += 1;
    } else {
      const report = result as DailyReport;
      const upsertRes = await sb.from("daily_reports").upsert(
        {
          developer_id: dev.developer_id,
          report_date: klDate,
          summary: report.summary,
          metrics: report.metrics,
          spec_progress: report.spec_progress,
          trajectory: report.trajectory,
          generator_version: report.generator_version,
          parse_failed: false,
          error_msg: null,
        },
        { onConflict: "developer_id,report_date" },
      );
      if (upsertRes.error) {
        console.error(
          `upsert failed (success) for ${dev.handle}: ${upsertRes.error.message}`,
        );
      }
      counters.reports_succeeded += 1;
    }
  }

  return counters;
}

async function main() {
  const env = loadEnv();
  // Cast: passing `db.schema` narrows the generic schema name; runDaily expects
  // a default-schema client. Behaviorally identical — the schema option only
  // affects the default `.from()` lookup table.
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
  const octokit = createGitHubClient();
  const result = await runDaily({ sb, octokit });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("run-daily failed:", err);
    process.exit(1);
  });
}
