import type { SupabaseClient } from "@supabase/supabase-js";
import type { Octokit } from "@octokit/rest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, createGitHubClient } from "@team-dashboard/shared";
import type { DailyReport } from "@team-dashboard/shared";
import { enumerateActiveBranches, enumerateOpenPrs } from "./enumerate.js";
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
  branches_synced: number;
  prs_synced: number;
}

interface BranchPayload {
  branch_name: string;
  head_sha: string;
  base_sha: string;
  diff_text: string;
  // Phase 3 Step 3 — fields for developer_active_branches sync
  repo_full_name: string;
  last_commit_at: string | null;
  last_commit_message: string | null;
  last_commit_author: string | null;
  commits_ahead: number;
  lines_added: number;
  lines_removed: number;
  files_changed: number;
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
    branches_synced: 0,
    prs_synced: 0,
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
      if (!lastCommit || !lastCommit.author_login) {
        // No author we can attribute to — skip.
        continue;
      }
      const handle = lastCommit.author_login;
      const payload: BranchPayload = {
        branch_name: branch.branch_name,
        head_sha: branch.head_sha,
        base_sha: baseSha,
        diff_text: buildDiffText(snapshot.files),
        repo_full_name: repo.full_name,
        last_commit_at: lastCommit.committed_at,
        last_commit_message: lastCommit.message,
        last_commit_author: lastCommit.author_login,
        commits_ahead: snapshot.commits.length,
        lines_added: snapshot.total_additions,
        lines_removed: snapshot.total_deletions,
        files_changed: snapshot.files.length,
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

  // 7. Sync developer_active_branches (Phase 3 Step 3).
  // Pattern: clear all rows for active developers + insert fresh rows for the
  // ones with branches today. Devs whose branch count went N→0 today have
  // their stale rows cleared; devs with M→K rows have the table reflect K.
  const activeDevsRes = await sb
    .from("developers")
    .select("id, github_handle")
    .eq("active", true);
  if (activeDevsRes.error) {
    console.error(
      `active devs query failed: ${activeDevsRes.error.message}`,
    );
  } else {
    const activeDevs = (activeDevsRes.data ?? []) as {
      id: string;
      github_handle: string;
    }[];
    const activeDevIds = activeDevs.map((d) => d.id);
    if (activeDevIds.length > 0) {
      const delRes = await sb
        .from("developer_active_branches")
        .delete()
        .in("developer_id", activeDevIds);
      if (delRes.error) {
        console.error(
          `developer_active_branches sync — delete failed: ${delRes.error.message}`,
        );
      }
    }

    // Dedupe by (developer_id, repo_full_name, branch_name) — the unique
    // constraint on developer_active_branches. Source of duplicates is
    // unstable: GH paginate.iterator can return overlapping pages, and an
    // upstream code path may push the same branch twice if a dev has multiple
    // commit authorships on the same branch. Last-write-wins keeps the freshest
    // payload per unique key.
    const branchInsertMap = new Map<string, {
      developer_id: string;
      repo_full_name: string;
      branch_name: string;
      head_sha: string;
      base_sha: string;
      last_commit_at: string | null;
      last_commit_message: string | null;
      last_commit_author: string | null;
      commits_ahead: number;
      lines_added: number;
      lines_removed: number;
      files_changed: number;
    }>();
    for (const dev of resolved) {
      for (const b of dev.branches) {
        const key = `${dev.developer_id}|${b.repo_full_name}|${b.branch_name}`;
        branchInsertMap.set(key, {
          developer_id: dev.developer_id,
          repo_full_name: b.repo_full_name,
          branch_name: b.branch_name,
          head_sha: b.head_sha,
          base_sha: b.base_sha,
          last_commit_at: b.last_commit_at,
          last_commit_message: b.last_commit_message,
          last_commit_author: b.last_commit_author,
          commits_ahead: b.commits_ahead,
          lines_added: b.lines_added,
          lines_removed: b.lines_removed,
          files_changed: b.files_changed,
        });
      }
    }
    const branchInserts = [...branchInsertMap.values()];
    if (branchInserts.length > 0) {
      const insRes = await sb
        .from("developer_active_branches")
        .insert(branchInserts);
      if (insRes.error) {
        console.error(
          `developer_active_branches sync — insert failed: ${insRes.error.message}`,
        );
      } else {
        counters.branches_synced = branchInserts.length;
      }
    }

    // 8. Sync developer_open_prs (Phase 3 Step 4).
    // Same delete-then-insert per active developer pattern. One GH search call
    // per (active dev × tracked repo) — at 16 devs × 1 repo = 16 calls, well
    // under the 5000/hour authed rate limit. Errors per dev fall back to
    // logging + continue (the sync is best-effort, not transactional).
    if (activeDevIds.length > 0) {
      const delPrs = await sb
        .from("developer_open_prs")
        .delete()
        .in("developer_id", activeDevIds);
      if (delPrs.error) {
        console.error(
          `developer_open_prs sync — delete failed: ${delPrs.error.message}`,
        );
      }
    }

    interface PrInsertRow {
      developer_id: string;
      repo_full_name: string;
      pr_number: number;
      pr_title: string;
      pr_url: string;
      pr_state: "open" | "draft";
      pr_created_at: string | null;
      pr_updated_at: string | null;
    }
    // Dedupe by the unique constraint columns (developer_id, repo, pr_number)
    // for the same reason as branches above — defensive against overlapping
    // search-API pages or upstream reshuffles.
    const prInsertMap = new Map<string, PrInsertRow>();
    for (const dev of activeDevs) {
      for (const repo of trackedRepos) {
        try {
          const prs = await enumerateOpenPrs(
            octokit,
            repo.full_name,
            dev.github_handle,
          );
          for (const pr of prs) {
            const key = `${dev.id}|${repo.full_name}|${pr.pr_number}`;
            prInsertMap.set(key, {
              developer_id: dev.id,
              repo_full_name: repo.full_name,
              pr_number: pr.pr_number,
              pr_title: pr.pr_title,
              pr_url: pr.pr_url,
              pr_state: pr.pr_state,
              pr_created_at: pr.pr_created_at,
              pr_updated_at: pr.pr_updated_at,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `enumerateOpenPrs failed for ${dev.github_handle} in ${repo.full_name}: ${msg}`,
          );
        }
      }
    }
    const prInserts = [...prInsertMap.values()];
    if (prInserts.length > 0) {
      const insPrs = await sb.from("developer_open_prs").insert(prInserts);
      if (insPrs.error) {
        console.error(
          `developer_open_prs sync — insert failed: ${insPrs.error.message}`,
        );
      } else {
        counters.prs_synced = prInserts.length;
      }
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
