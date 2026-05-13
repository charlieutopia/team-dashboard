import type { Octokit } from "@octokit/rest";

export interface DiffSnapshot {
  files: { filename: string; patch: string; status: string }[];
  commits: {
    sha: string;
    message: string;
    author_login: string | null;
    committed_at: string | null;
  }[];
  total_additions: number;
  total_deletions: number;
}

export async function getDiffBetweenCommits(
  octokit: Octokit,
  repoFullName: string,
  baseSha: string,
  headSha: string,
): Promise<DiffSnapshot> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo: ${repoFullName}`);
  if (baseSha === headSha) {
    return { files: [], commits: [], total_additions: 0, total_deletions: 0 };
  }

  const { data } = await octokit.repos.compareCommits({
    owner,
    repo,
    base: baseSha,
    head: headSha,
  });

  return {
    files: (data.files ?? []).map((f) => ({
      filename: f.filename,
      patch: f.patch ?? "",
      status: f.status,
    })),
    commits: data.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author_login: c.author?.login ?? null,
      committed_at:
        c.commit.author?.date ?? c.commit.committer?.date ?? null,
    })),
    total_additions: (data as { stats?: { additions?: number } }).stats?.additions ?? 0,
    total_deletions: (data as { stats?: { deletions?: number } }).stats?.deletions ?? 0,
  };
}
