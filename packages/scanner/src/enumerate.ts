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
