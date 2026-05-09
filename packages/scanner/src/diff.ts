import type { Octokit } from "@octokit/rest";

export interface DiffSnapshot {
  files: { filename: string; patch: string; status: string }[];
  commits: { sha: string; message: string; author_login: string | null }[];
}

export async function getDiffBetweenCommits(
  octokit: Octokit,
  repoFullName: string,
  baseSha: string,
  headSha: string,
): Promise<DiffSnapshot> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo: ${repoFullName}`);
  if (baseSha === headSha) return { files: [], commits: [] };

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
    })),
  };
}
