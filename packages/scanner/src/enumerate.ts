import type { Octokit } from "@octokit/rest";

export interface BranchInfo {
  repo_full_name: string;
  branch_name: string;
  head_sha: string;
}

const FEATURE_PREFIXES = ["wip/", "feat/", "fix/"];

export async function enumerateActiveBranches(
  octokit: Octokit,
  repoFullName: string,
): Promise<BranchInfo[]> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo full_name: ${repoFullName}`);

  const result: BranchInfo[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.repos.listBranches,
    {
      owner,
      repo,
      per_page: 100,
    },
  )) {
    for (const branch of response.data) {
      if (FEATURE_PREFIXES.some((p) => branch.name.startsWith(p))) {
        result.push({
          repo_full_name: repoFullName,
          branch_name: branch.name,
          head_sha: branch.commit.sha,
        });
      }
    }
  }
  return result;
}

export interface OpenPrInfo {
  pr_number: number;
  pr_title: string;
  pr_url: string;
  pr_state: "open" | "draft";
  pr_created_at: string | null;
  pr_updated_at: string | null;
}

/**
 * Phase 3 Step 4: list a developer's open PRs in a single repo via the GH
 * search API. One API call per (repo, developer) pair — well under 5000/hour
 * authed limit at typical team sizes.
 */
export async function enumerateOpenPrs(
  octokit: Octokit,
  repoFullName: string,
  authorHandle: string,
): Promise<OpenPrInfo[]> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo full_name: ${repoFullName}`);

  const q = `is:pr is:open author:${authorHandle} repo:${repoFullName}`;
  const { data } = await octokit.search.issuesAndPullRequests({
    q,
    per_page: 100,
  });

  return (data.items ?? []).map((it) => {
    const draft = (it as { draft?: boolean }).draft ?? false;
    return {
      pr_number: it.number,
      pr_title: it.title,
      pr_url: it.html_url,
      pr_state: draft ? ("draft" as const) : ("open" as const),
      pr_created_at: it.created_at ?? null,
      pr_updated_at: it.updated_at ?? null,
    };
  });
}
