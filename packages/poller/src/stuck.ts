import type { Octokit } from "@octokit/rest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectStuck } from "@team-dashboard/detector-stuck";

type TeamDashboardClient = SupabaseClient<any, "public", any, any, any>;

interface BranchMetadata {
  repo_id: string;
  repo_full_name: string;
  branch_name: string;
  developer_handle: string | null;
  branch_age_hours: number;
  hours_since_last_commit: number;
  commit_cadence_per_day: number;
  blocker_keyword_hits: number;
}

async function getBranchMetadata(
  octokit: Octokit,
  repo: { id: string; full_name: string },
  branch_name: string,
  sb: TeamDashboardClient,
): Promise<BranchMetadata | null> {
  try {
    const [owner, repoName] = repo.full_name.split("/");
    if (!owner || !repoName) return null;

    // Get branch ref to find head commit
    const { data: branchData } = await octokit.repos.getBranch({
      owner,
      repo: repoName,
      branch: branch_name,
    });

    const headSha = branchData.commit.sha;
    const headCommitTimestamp = new Date(branchData.commit.commit.author!.date!).getTime();
    const nowTime = Date.now();
    const hours_since_last_commit = Math.floor((nowTime - headCommitTimestamp) / (1000 * 60 * 60));

    // Get commits from last 7 days
    const sevenDaysAgo = new Date(nowTime - 7 * 24 * 60 * 60 * 1000);
    const commits: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data: pageCommits } = await octokit.repos.listCommits({
        owner,
        repo: repoName,
        sha: branch_name,
        since: sevenDaysAgo.toISOString(),
        per_page: 100,
        page,
      });

      if (!pageCommits || pageCommits.length === 0) {
        hasMore = false;
        break;
      }

      commits.push(...pageCommits);
      if (pageCommits.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    const commit_cadence_per_day = commits.length / 7;

    // Count blocker keywords in last 5 commit messages
    const blockerKeywords = ["blocked", "stuck", "wait", "waiting", "todo"];
    let blocker_keyword_hits = 0;
    for (let i = 0; i < Math.min(5, commits.length); i++) {
      const msg = (commits[i].commit.message || "").toLowerCase();
      for (const kw of blockerKeywords) {
        if (msg.includes(kw)) {
          blocker_keyword_hits++;
        }
      }
    }

    // Branch age: from first commit on this branch (or branch creation)
    // Phase 1: use branch_commit.author.date as a proxy; ideally we'd query branch creation time
    const oldestCommitTimestamp = commits.length > 0 ? new Date(commits[commits.length - 1].commit.author!.date!).getTime() : headCommitTimestamp;
    const branch_age_hours = Math.floor((nowTime - oldestCommitTimestamp) / (1000 * 60 * 60));

    // Developer handle: from head commit author
    const developer_handle = branchData.commit.commit.author?.name ?? null;

    return {
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      branch_name,
      developer_handle,
      branch_age_hours,
      hours_since_last_commit,
      commit_cadence_per_day,
      blocker_keyword_hits,
    };
  } catch (err) {
    console.warn(`Failed to get metadata for ${repo.full_name}:${branch_name}:`, err);
    return null;
  }
}

export async function computeAndPersistStuckSignals(
  sb: TeamDashboardClient,
  octokit: Octokit,
  repos: { id: string; full_name: string }[],
) {
  const allSignals: any[] = [];

  for (const repo of repos) {
    try {
      const [owner, repoName] = repo.full_name.split("/");
      if (!owner || !repoName) continue;

      // List branches (paginated)
      const branches: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const { data: pageBranches } = await octokit.repos.listBranches({
          owner,
          repo: repoName,
          per_page: 100,
          page,
        });

        if (!pageBranches || pageBranches.length === 0) {
          hasMore = false;
          break;
        }

        branches.push(...pageBranches);
        if (pageBranches.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      for (const branch of branches) {
        const metadata = await getBranchMetadata(octokit, repo, branch.name, sb);
        if (!metadata) continue;

        const signal = detectStuck({
          repo_full_name: metadata.repo_full_name,
          branch: metadata.branch_name,
          developer_handle: metadata.developer_handle,
          branch_age_hours: metadata.branch_age_hours,
          hours_since_last_commit: metadata.hours_since_last_commit,
          commit_cadence_per_day: metadata.commit_cadence_per_day,
          blocker_keyword_hits: metadata.blocker_keyword_hits,
        });

        // Map developer_handle to developer_id
        let developerId: string | null = null;
        if (metadata.developer_handle) {
          const { data: dev } = await sb
            .from("developers")
            .select("id")
            .eq("github_handle", metadata.developer_handle)
            .maybeSingle();
          developerId = dev?.id ?? null;
        }

        allSignals.push({
          repo_id: metadata.repo_id,
          developer_id: developerId,
          branch: metadata.branch_name,
          signal: signal.signal,
          reasons: signal.reasons,
          branch_age_hours: signal.branch_age_hours,
          hours_since_last_commit: signal.hours_since_last_commit,
          commit_cadence_per_day: signal.commit_cadence_per_day,
          blocker_keyword_hits: signal.blocker_keyword_hits,
        });
      }
    } catch (err) {
      console.warn(`Failed to process repo ${repo.full_name}:`, err);
    }
  }

  if (allSignals.length === 0) {
    console.log("No stuck signals to persist");
    return;
  }

  const { error } = await sb.from("stuck_signals").insert(allSignals);
  if (error) throw error;

  console.log(`Inserted ${allSignals.length} stuck signals`);
}
