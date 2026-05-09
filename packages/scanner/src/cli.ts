import { createClient } from "@supabase/supabase-js";
import {
  createGitHubClient,
  createOpenAIClient,
  loadEnv,
} from "@team-dashboard/shared";
import { buildBatchRequest as buildDriftRequest } from "@team-dashboard/detector-drift";
import { buildBatchRequest as buildReportRequest } from "@team-dashboard/report-generator";
import { enumerateActiveBranches } from "./enumerate.js";
import { getDiffBetweenCommits } from "./diff.js";
import { getSpecForModule } from "./spec.js";
import { submitBatchForJob } from "./submit.js";

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const octokit = createGitHubClient();
  const openai = createOpenAIClient();

  // KL date = UTC + 8 hours
  const now = new Date();
  const klDate = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  // Idempotency check
  const { data: existing } = await sb
    .from("batch_jobs")
    .select("id")
    .eq("job_date", klDate)
    .maybeSingle();
  if (existing) {
    console.log(`Batch already submitted for ${klDate} (id: ${existing.id})`);
    return;
  }

  // 1. Read tracked_repos
  const { data: repos, error } = await sb
    .from("tracked_repos")
    .select("id, full_name, spec_module")
    .eq("active", true);
  if (error) throw error;
  if (!repos || repos.length === 0) {
    console.log("No active tracked repos — exit");
    return;
  }

  // 2. For each repo: enumerate branches, build batch lines
  const allBatchLines: any[] = [];
  for (const repo of repos) {
    const branches = await enumerateActiveBranches(octokit, repo.full_name);
    if (branches.length === 0) continue;

    const specText = await getSpecForModule(octokit, repo.spec_module);

    for (const branch of branches) {
      // Get default branch info
      const [owner, repoName] = repo.full_name.split("/");
      if (!owner || !repoName) continue;

      const { data: defaultBranchInfo } = await octokit.repos.get({
        owner,
        repo: repoName,
      });
      const defaultBranch = defaultBranchInfo.default_branch;
      const { data: defaultRef } = await octokit.repos.getBranch({
        owner,
        repo: repoName,
        branch: defaultBranch,
      });
      const baseSha = defaultRef.commit.sha;

      const todayDiff = await getDiffBetweenCommits(
        octokit,
        repo.full_name,
        baseSha,
        branch.head_sha,
      );
      const yesterdayDiff = todayDiff; // Phase 1: simplification

      // Author resolution
      const lastAuthorLogin =
        todayDiff.commits[todayDiff.commits.length - 1]?.author_login;
      let developerId: string | null = null;
      if (!lastAuthorLogin) {
        console.log(
          `No commits found for ${repo.full_name}:${branch.branch_name}`,
        );
        continue;
      }

      const { data: dev } = await sb
        .from("developers")
        .select("id")
        .eq("github_handle", lastAuthorLogin)
        .maybeSingle();
      developerId = dev?.id ?? null;

      if (!developerId) {
        console.log(
          `No matching developer for ${repo.full_name}:${branch.branch_name} (last author: ${lastAuthorLogin})`,
        );
        continue;
      }

      const todayDiffText = formatDiff(todayDiff);
      const yesterdayDiffText = formatDiff(yesterdayDiff);

      // Build drift batch line
      const driftReq = buildDriftRequest(
        {
          developer_handle: lastAuthorLogin,
          date: klDate,
          spec_text: specText,
          diff_text: todayDiffText,
        },
        `drift|${repo.id}|${branch.branch_name}|${branch.head_sha}|${klDate}`,
      );
      allBatchLines.push(driftReq);

      // Build report batch line
      const reportReq = buildReportRequest(
        {
          developer_handle: lastAuthorLogin,
          date: klDate,
          spec_text: specText,
          today_diff: todayDiffText,
          yesterday_diff: yesterdayDiffText,
        },
        `report|${repo.id}|${developerId}|${klDate}`,
      );
      allBatchLines.push(reportReq);
    }
  }

  if (allBatchLines.length === 0) {
    console.log("No batch lines to submit — exit");
    return;
  }

  // 3. Submit
  const batchId = await submitBatchForJob(openai, allBatchLines);

  // 4. Persist (defensive — orphan batch is recoverable but operator must know)
  const { error: insertError } = await sb
    .from("batch_jobs")
    .insert({ job_date: klDate, openai_batch_id: batchId, status: "submitted" });

  if (insertError) {
    console.error(
      `ORPHAN BATCH WARNING: OpenAI batch ${batchId} submitted but batch_jobs insert failed.`,
      `Manually insert: { job_date: '${klDate}', openai_batch_id: '${batchId}', status: 'submitted' }`,
      `Insert error:`, insertError,
    );
    throw insertError;
  }

  console.log(
    `Submitted batch ${batchId} with ${allBatchLines.length} lines for ${klDate}`,
  );
}

function formatDiff(snapshot: {
  files: { filename: string; patch: string }[];
}): string {
  return snapshot.files.map((f) => `--- ${f.filename}\n${f.patch}`).join("\n\n");
}

main().catch((err) => {
  console.error("Scanner failed:", err);
  process.exit(1);
});
