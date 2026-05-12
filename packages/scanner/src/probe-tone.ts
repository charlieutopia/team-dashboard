// Tone-validation probe — runs the Boss-readable analyzer on a hand-picked
// subset of developers without upserting. Use during prompt iteration to
// inspect the summary before regenerating production reports.
//
// Usage: pnpm --filter @team-dashboard/scanner exec tsx src/probe-tone.ts naznajmuddin nuraddlynn

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, createGitHubClient } from "@team-dashboard/shared";
import { enumerateActiveBranches } from "./enumerate.js";
import { getDiffBetweenCommits } from "./diff.js";
import { getSpecForModule } from "./spec.js";
import { analyzeDevDay, type AnalyzeInput } from "./analyze.js";

const MAX_DIFF_TEXT_BYTES_PER_BRANCH = 30_000;

function buildDiffText(files: { filename: string; patch: string }[]): string {
  const full = files.map((f) => `--- ${f.filename}\n${f.patch}`).join("\n\n");
  const fullBytes = Buffer.byteLength(full, "utf8");
  if (fullBytes <= MAX_DIFF_TEXT_BYTES_PER_BRANCH) return full;
  return (
    full.slice(0, MAX_DIFF_TEXT_BYTES_PER_BRANCH) +
    `\n\n[... TRUNCATED — original ${fullBytes} bytes ...]`
  );
}

function computeKlDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().split("T")[0]!;
}

async function main() {
  const targetHandles = process.argv.slice(2);
  if (targetHandles.length === 0) {
    console.error(
      "Usage: tsx src/probe-tone.ts <handle1> [<handle2> ...]",
    );
    process.exit(1);
  }
  console.error(`Probing tone for: ${targetHandles.join(", ")}`);

  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
  const octokit = createGitHubClient();

  const klDate = computeKlDate(new Date());

  const trackedRes = await sb
    .from("tracked_repos")
    .select("id, full_name, spec_module")
    .eq("active", true);
  if (trackedRes.error) throw new Error(trackedRes.error.message);
  const repos = trackedRes.data as { full_name: string; spec_module: string }[];
  if (repos.length === 0) throw new Error("no tracked_repos active");

  const repo = repos[0]!;
  const [owner, repoName] = repo.full_name.split("/");
  if (!owner || !repoName) throw new Error(`bad repo full_name: ${repo.full_name}`);

  console.error(`Enumerating active branches in ${repo.full_name} ...`);
  const branches = await enumerateActiveBranches(octokit, repo.full_name);
  const repoMeta = await octokit.repos.get({ owner, repo: repoName });
  const defaultBranchData = await octokit.repos.getBranch({
    owner,
    repo: repoName,
    branch: repoMeta.data.default_branch,
  });
  const baseSha = defaultBranchData.data.commit.sha;
  const specText = await getSpecForModule(octokit, repo.spec_module);

  const branchesByHandle = new Map<
    string,
    {
      branch_name: string;
      head_sha: string;
      base_sha: string;
      diff_text: string;
    }[]
  >();

  for (const branch of branches) {
    const snapshot = await getDiffBetweenCommits(
      octokit,
      repo.full_name,
      baseSha,
      branch.head_sha,
    );
    const lastCommit = snapshot.commits[snapshot.commits.length - 1];
    const handle = lastCommit?.author_login ?? null;
    if (!handle || !targetHandles.includes(handle)) continue;
    const payload = {
      branch_name: branch.branch_name,
      head_sha: branch.head_sha,
      base_sha: baseSha,
      diff_text: buildDiffText(snapshot.files),
    };
    const existing = branchesByHandle.get(handle);
    if (existing) existing.push(payload);
    else branchesByHandle.set(handle, [payload]);
  }

  for (const handle of targetHandles) {
    const branches = branchesByHandle.get(handle);
    if (!branches || branches.length === 0) {
      console.log(`\n=== ${handle} — NO BRANCHES TODAY ===\n`);
      continue;
    }
    const devRes = await sb
      .from("developers")
      .select("display_name")
      .eq("github_handle", handle)
      .maybeSingle();
    const display_name =
      (devRes.data as { display_name: string | null } | null)?.display_name ??
      undefined;

    const input: AnalyzeInput = {
      developer_handle: handle,
      date: klDate,
      repo_full_name: repo.full_name,
      branches,
      spec_text: specText,
      display_name: display_name ?? undefined,
    };

    console.error(
      `\nAnalyzing ${handle} (display=${display_name ?? "n/a"}, branches=${branches.length}, total_diff=${branches.reduce((s, b) => s + b.diff_text.length, 0)} bytes) ...`,
    );
    const t0 = Date.now();
    const result = await analyzeDevDay(input);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n=== ${handle} (${elapsed}s) ===`);
    if ("parse_failed" in result && result.parse_failed) {
      console.log(`FAILED: ${result.error_msg}`);
      continue;
    }
    const report = result as Exclude<typeof result, { parse_failed: true }>;
    const wc = report.summary.trim().split(/\s+/).filter(Boolean).length;
    console.log(`trajectory: ${report.trajectory}`);
    console.log(`word count: ${wc}`);
    console.log(`summary:\n${report.summary}`);
  }
}

main().catch((err) => {
  console.error("probe-tone failed:", err);
  process.exit(1);
});
