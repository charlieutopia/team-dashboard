import type { Octokit } from "@octokit/rest";

export interface BranchInfo {
  repo_full_name: string;
  branch_name: string;
  head_sha: string;
}

export interface OrgRepoInfo {
  full_name: string;
}

const FEATURE_PREFIXES = ["wip/", "feat/", "fix/"];

/**
 * Phase 1 org-scan: list every repo in `org` that has been pushed to within
 * the scan window. Replaces the single hardcoded tracked repo. We page through
 * the org's repos and keep only the live ones — archived and disabled repos
 * are dropped, and repos with no recent push (older than `pushedSinceISO`) are
 * skipped so the daily run never diffs a dormant repo.
 */
export async function enumerateOrgRepos(
  octokit: Octokit,
  org: string,
  pushedSinceISO: string,
): Promise<OrgRepoInfo[]> {
  const since = new Date(pushedSinceISO).getTime();
  const result: OrgRepoInfo[] = [];
  // The installed @octokit/rest exposes the GET /orgs/{org}/repos endpoint as
  // `repos.listForOrg` (there is no `orgs.listRepos` in this version). Same
  // endpoint, same `type`/`per_page` params.
  for await (const response of octokit.paginate.iterator(
    octokit.repos.listForOrg,
    {
      org,
      type: "all",
      per_page: 100,
    },
  )) {
    for (const repo of response.data) {
      const archived = (repo as { archived?: boolean }).archived ?? false;
      const disabled = (repo as { disabled?: boolean }).disabled ?? false;
      if (archived || disabled) continue;
      const pushedAt = (repo as { pushed_at?: string | null }).pushed_at;
      if (!pushedAt) continue;
      if (new Date(pushedAt).getTime() < since) continue;
      result.push({ full_name: repo.full_name });
    }
  }
  return result;
}

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
