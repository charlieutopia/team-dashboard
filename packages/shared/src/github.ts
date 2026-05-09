import { Octokit } from "@octokit/rest";
import { loadEnv } from "./env.js";

export function createGitHubClient(): Octokit {
  const env = loadEnv();
  return new Octokit({ auth: env.GH_READ_TOKEN });
}
