import type { SupabaseClient } from "@supabase/supabase-js";
import type { Octokit } from "@octokit/rest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, createGitHubClient } from "@team-dashboard/shared";
import type { DailyReport } from "@team-dashboard/shared";
import {
  enumerateActiveBranches,
  enumerateOpenPrs,
  enumerateOrgRepos,
} from "./enumerate.js";
import { getDiffBetweenCommits } from "./diff.js";
import { analyzeDevDay, type AnalyzeInput, type AnalyzeResult } from "./analyze.js";

// The GitHub org the daily scan walks. Every non-archived, non-disabled repo
// pushed within the scan window is included.
const ORG = "utopiabuilder";

// How far back a repo's last push can be and still count as "live" for this
// run. Env-overridable so a backfill or a quiet-weekend run can widen the
// window without a code change.
const ORG_SCAN_PUSHED_DAYS = Number(process.env.ORG_SCAN_PUSHED_DAYS ?? "3");

// GitHub's search API is capped at 30 requests/min. The open-PR sync makes one
// search call per (active dev × repo); a 2.1s pause between consecutive calls
// keeps us under ~28/min even with no other search traffic.
const PR_SEARCH_DELAY_MS = 2100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
  developers_auto_discovered: number;
  reports_skipped_stale: number;
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
  // Phase 2 quality — the per-branch list of file paths touched. Feeds the
  // weekly quality signals (e.g. test discipline) downstream of run-daily.
  files_touched: string[];
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

// Per-dev prompt bounds (org-wide scan). The per-branch cap alone is not enough:
// a dev with many branches across many repos merges into ONE prompt for
// analyzeDevDay, so the combined size still blows past context and the CLI
// exits 1 ("spawn exit 1") or times out. A 30-day backfill failed 11 of 12
// reports this way. Two extra caps keep the merged prompt bounded:
//   1. MAX_BRANCHES_PER_DEV — keep only the N most recently committed branches
//      in the AI prompt (the rest still sync their metadata to
//      developer_active_branches; they just don't go into the prompt).
//   2. MAX_TOTAL_DIFF_CHARS — a combined diff-text budget across the kept
//      branches, walked newest-first.
// Both env-overridable so a backfill can tune them without a code change.
const MAX_BRANCHES_PER_DEV = Number(process.env.MAX_BRANCHES_PER_DEV ?? "6");
const MAX_TOTAL_DIFF_CHARS = Number(
  process.env.MAX_TOTAL_DIFF_CHARS ?? "60000",
);

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

// Sort a dev's branches newest-first by last commit. A branch with a null
// last_commit_at sorts last (we can't prove it is recent). Pure (does not
// mutate the input array).
function sortBranchesNewestFirst(branches: BranchPayload[]): BranchPayload[] {
  return [...branches].sort((a, b) => {
    const at = a.last_commit_at ? new Date(a.last_commit_at).getTime() : 0;
    const bt = b.last_commit_at ? new Date(b.last_commit_at).getTime() : 0;
    return bt - at;
  });
}

// Build the branch list that goes INTO the AI prompt for one dev. Caps both the
// branch count and the combined diff-text size so the merged prompt stays
// bounded regardless of how many branches/repos the dev touched.
//
// Steps:
//   1. Sort newest-first, keep at most `maxBranches`.
//   2. Walk the kept branches newest-first, spending a `maxTotalChars` budget:
//      - include each branch's (already 30KB-capped) diff until the budget runs
//        out;
//      - the branch that overflows is truncated to fit + "\n...(diff truncated)";
//      - every branch after the budget is exhausted keeps its name/metadata but
//        carries an empty diff.
// The dropped older branches and emptied diffs only affect the PROMPT — the
// caller still syncs the full `dev.branches` to developer_active_branches.
const DIFF_TRUNCATION_MARKER = "\n...(diff truncated)";

export function selectBranchesForAnalysis(
  branches: BranchPayload[],
  maxBranches: number = MAX_BRANCHES_PER_DEV,
  maxTotalChars: number = MAX_TOTAL_DIFF_CHARS,
): BranchPayload[] {
  const kept = sortBranchesNewestFirst(branches).slice(0, maxBranches);

  let remaining = maxTotalChars;
  return kept.map((b) => {
    const diff = b.diff_text ?? "";
    if (remaining <= 0) {
      // Budget already spent — keep metadata, drop the diff entirely.
      return { ...b, diff_text: "" };
    }
    if (diff.length <= remaining) {
      remaining -= diff.length;
      return b;
    }
    // This branch overflows the budget. Truncate to what fits, leaving room for
    // the marker, then exhaust the budget so later branches carry no diff.
    const room = Math.max(0, remaining - DIFF_TRUNCATION_MARKER.length);
    remaining = 0;
    return { ...b, diff_text: diff.slice(0, room) + DIFF_TRUNCATION_MARKER };
  });
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
    developers_auto_discovered: 0,
    reports_skipped_stale: 0,
    branches_synced: 0,
    prs_synced: 0,
  };

  // 0. Auto-flip ended developers to inactive. Anyone whose end_date has
  // already passed (strictly before today in KL) should drop off the main
  // views — "ended = inactive". The Manage Team editor flips past/today end
  // dates immediately; this catches dates that pass over time (e.g. a future
  // end date set last week that has now arrived). Best-effort: log + continue
  // on error so a flip failure never blocks the daily report run.
  const endedRes = await sb
    .from("developers")
    .update({ active: false })
    .lt("end_date", klDate)
    .not("end_date", "is", null)
    .eq("active", true)
    .select("id");
  if (endedRes.error) {
    console.error(
      `ended-developer auto-flip failed: ${endedRes.error.message}`,
    );
  } else {
    const flipped = endedRes.data?.length ?? 0;
    if (flipped > 0) {
      console.log(`auto-flipped ${flipped} ended developer(s) to inactive`);
    }
  }

  // 1. Enumerate every live repo in the org pushed within the scan window.
  // Replaces the old single hardcoded tracked_repos row. Repos that are
  // archived, disabled, or dormant (no push inside the window) are dropped by
  // enumerateOrgRepos.
  const pushedSince = new Date(
    Date.now() - ORG_SCAN_PUSHED_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const orgRepos = await enumerateOrgRepos(octokit, ORG, pushedSince);
  if (orgRepos.length === 0) {
    return counters;
  }

  // Group branches by developer handle ONLY, across all repos. Each branch
  // carries its own repo, so one dev's report can span multiple projects.
  const branchesByHandle = new Map<string, BranchPayload[]>();

  for (const repo of orgRepos) {
    const branches = await enumerateActiveBranches(octokit, repo.full_name);
    if (branches.length === 0) {
      continue;
    }

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
        files_touched: snapshot.files.map((f) => f.filename),
      };
      const existing = branchesByHandle.get(handle);
      if (existing) {
        existing.push(payload);
      } else {
        branchesByHandle.set(handle, [payload]);
      }
    }
  }

  // 5. Resolve developer ids — auto-discover any handle not yet in the table.
  // Org-wide scanning means contributors appear without an HR onboarding step.
  // For every handle we saw this run, if there is no developers row we insert a
  // minimal auto-discovered one so the person still gets a report. email is NOT
  // NULL + UNIQUE, so we synthesize the GitHub no-reply address to keep the
  // insert valid; display_name comes from the GitHub profile name when set.
  interface ResolvedDev {
    handle: string;
    developer_id: string;
    display_name: string | null;
    branches: BranchPayload[];
  }

  const seenHandles = [...branchesByHandle.keys()];

  // Which handles already have a developers row?
  const existingDevs = new Map<
    string,
    { id: string; display_name: string | null }
  >();
  if (seenHandles.length > 0) {
    const existRes = await sb
      .from("developers")
      .select("id, github_handle, display_name")
      .in("github_handle", seenHandles);
    if (existRes.error) {
      throw new Error(
        `developers lookup failed: ${existRes.error.message}`,
      );
    }
    for (const r of (existRes.data ?? []) as {
      id: string;
      github_handle: string;
      display_name: string | null;
    }[]) {
      existingDevs.set(r.github_handle, {
        id: r.id,
        display_name: r.display_name,
      });
    }
  }

  // Insert a minimal row for each missing handle (only call getByUsername for
  // the missing ones). Upsert ignores on conflict so two concurrent runs can't
  // collide on the github_handle unique key.
  const missingHandles = seenHandles.filter((h) => !existingDevs.has(h));
  for (const handle of missingHandles) {
    let profileName: string | null = null;
    try {
      const profile = await octokit.users.getByUsername({ username: handle });
      profileName = (profile.data as { name?: string | null }).name ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`getByUsername failed for ${handle}: ${msg}`);
    }
    const displayName = profileName && profileName.trim() ? profileName : handle;
    const insRes = await sb
      .from("developers")
      .upsert(
        {
          github_handle: handle,
          display_name: displayName,
          email: `${handle}@users.noreply.github.com`,
          active: true,
          auto_discovered: true,
        },
        { onConflict: "github_handle", ignoreDuplicates: true },
      )
      .select("id, display_name")
      .maybeSingle();
    if (insRes.error) {
      console.error(
        `auto-discover insert failed for ${handle}: ${insRes.error.message}`,
      );
      continue;
    }
    counters.developers_auto_discovered += 1;
    const inserted = insRes.data as
      | { id: string; display_name: string | null }
      | null;
    if (inserted) {
      existingDevs.set(handle, {
        id: inserted.id,
        display_name: inserted.display_name,
      });
    } else {
      // ignoreDuplicates can return no row when a concurrent run won the insert.
      // Re-read so the dev still resolves and gets a report this run.
      const reread = await sb
        .from("developers")
        .select("id, display_name")
        .eq("github_handle", handle)
        .maybeSingle();
      const row = reread.data as
        | { id: string; display_name: string | null }
        | null;
      if (row) {
        existingDevs.set(handle, {
          id: row.id,
          display_name: row.display_name,
        });
      }
    }
  }

  const resolved: ResolvedDev[] = [];
  for (const [handle, branches] of branchesByHandle) {
    const row = existingDevs.get(handle);
    if (!row) {
      console.log(`skip ${handle}: no developers row could be resolved`);
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
  // Since-filter: skip the AI call for a dev whose branches ALL have their last
  // commit before the scan window. Their branch metadata still syncs below (so
  // the dashboard keeps showing the branch); we just don't burn an AI call
  // re-summarizing work that did not move inside the window. A branch with a
  // null last_commit_at is treated as in-window (we can't prove it's stale).
  const sinceMs = new Date(pushedSince).getTime();
  for (const dev of resolved) {
    const hasFreshBranch = dev.branches.some((b) => {
      if (!b.last_commit_at) return true;
      return new Date(b.last_commit_at).getTime() >= sinceMs;
    });
    if (!hasFreshBranch) {
      console.log(
        `skip-stale ${dev.handle}: all branches older than scan window`,
      );
      counters.reports_skipped_stale += 1;
      continue;
    }

    counters.developers_analyzed += 1;
    // Cap the prompt payload — branch count + combined diff size — so a dev
    // with many branches across many repos can't merge into a prompt that
    // crashes or times out the claude CLI. The full dev.branches still sync to
    // developer_active_branches below; only what the AI sees is bounded.
    const promptBranches = selectBranchesForAnalysis(dev.branches);
    let result: AnalyzeResult;
    try {
      result = await analyze({
        developer_handle: dev.handle,
        date: klDate,
        branches: promptBranches,
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
    // Only active developers' rows belong on the dashboard surfaces. Inactive
    // devs are hidden everywhere except /admin/team, so we never insert their
    // branches or PRs even when their commits still appear upstream.
    const activeDevIdSet = new Set(activeDevIds);
    // Snapshot semantics: clear ALL rows, then re-insert from this run's
    // enumeration (which includes inactive devs whose branches still exist
    // upstream). Earlier scoping the delete to active devs only created a
    // duplicate-key trap because inactive devs' rows survived from the prior
    // run while their fresh enumerated rows tried to land on the same key.
    // Supabase JS rejects an unfiltered .delete(), so use a sentinel filter.
    const delRes = await sb
      .from("developer_active_branches")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delRes.error) {
      console.error(
        `developer_active_branches sync — delete failed: ${delRes.error.message}`,
      );
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
      files_touched: string[];
    }>();
    for (const dev of resolved) {
      // Skip inactive devs — their branches are dashboard-hidden.
      if (!activeDevIdSet.has(dev.developer_id)) continue;
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
          files_touched: b.files_touched,
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
    // per (active dev × org repo). The search API caps at 30/min, so we pause
    // PR_SEARCH_DELAY_MS between consecutive search calls. Errors per dev fall
    // back to logging + continue (the sync is best-effort, not transactional).
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
    let prSearchCount = 0;
    for (const dev of activeDevs) {
      for (const repo of orgRepos) {
        // Rate-limit guard: GitHub search caps at 30/min. Pause before every
        // search call except the first.
        if (prSearchCount > 0) {
          await sleep(PR_SEARCH_DELAY_MS);
        }
        prSearchCount += 1;
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
