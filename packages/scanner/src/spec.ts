import type { Octokit } from "@octokit/rest";

const UTOPIASPACE_OWNER = "utopiabuilder";
const UTOPIASPACE_REPO = "utopiaspace";
const UTOPIASPACE_REF = "development"; // utopiaspace default branch is `development`, NOT `main`

export async function getSpecForModule(
  octokit: Octokit,
  specModule: string,
): Promise<string> {
  const path = `openspec/specs/${specModule}`;
  return await fetchDirRecursive(octokit, path);
}

async function fetchDirRecursive(octokit: Octokit, path: string): Promise<string> {
  let result = "";
  try {
    const { data } = await octokit.repos.getContent({
      owner: UTOPIASPACE_OWNER,
      repo: UTOPIASPACE_REPO,
      path,
      ref: UTOPIASPACE_REF,
    });
    if (!Array.isArray(data)) {
      // single file
      if ("content" in data && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return "";
    }
    // directory listing
    for (const item of data) {
      if (item.type === "file" && item.name.endsWith(".md")) {
        const content = await fetchDirRecursive(octokit, item.path);
        result += `\n\n---\n# File: ${item.path}\n\n${content}`;
      } else if (item.type === "dir") {
        result += await fetchDirRecursive(octokit, item.path);
      }
    }
    return result;
  } catch (e: any) {
    if (e.status === 404) return ""; // empty spec is OK for Phase 1
    throw e;
  }
}
