import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDiffBetweenCommits } from "../diff.js";
import type { Octokit } from "@octokit/rest";

describe("getDiffBetweenCommits", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      repos: {
        compareCommits: vi.fn(),
      },
    } as any;
  });

  it("returns empty diff when base and head are same", async () => {
    const result = await getDiffBetweenCommits(
      mockOctokit,
      "owner/repo",
      "abc123",
      "abc123",
    );

    expect(result).toEqual({ files: [], commits: [] });
    expect(mockOctokit.repos.compareCommits).not.toHaveBeenCalled();
  });

  it("parses files and commits from API response", async () => {
    vi.mocked(mockOctokit.repos.compareCommits).mockResolvedValue({
      data: {
        files: [
          {
            filename: "src/app.ts",
            patch: "-old line\n+new line",
            status: "modified",
          },
          {
            filename: "src/feature.ts",
            patch: "+feature implementation",
            status: "added",
          },
        ],
        commits: [
          {
            sha: "commit1",
            commit: { message: "feat: add feature" },
            author: { login: "alice" },
          },
          {
            sha: "commit2",
            commit: { message: "fix: bug fix" },
            author: null,
          },
        ],
      } as any,
    } as any);

    const result = await getDiffBetweenCommits(
      mockOctokit,
      "owner/repo",
      "abc123",
      "def456",
    );

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({
      filename: "src/app.ts",
      patch: "-old line\n+new line",
      status: "modified",
    });
    expect(result.commits).toHaveLength(2);
    expect(result.commits[0]).toEqual({
      sha: "commit1",
      message: "feat: add feature",
      author_login: "alice",
    });
    expect(result.commits[1]?.author_login).toBeNull();
  });

  it("handles missing patch gracefully", async () => {
    vi.mocked(mockOctokit.repos.compareCommits).mockResolvedValue({
      data: {
        files: [
          {
            filename: "src/binary.bin",
            patch: undefined,
            status: "added",
          },
        ],
        commits: [],
      } as any,
    } as any);

    const result = await getDiffBetweenCommits(
      mockOctokit,
      "owner/repo",
      "abc123",
      "def456",
    );

    expect(result.files[0]?.patch).toBe("");
  });

  it("throws on invalid repo name", async () => {
    await expect(
      getDiffBetweenCommits(mockOctokit, "invalid", "abc123", "def456"),
    ).rejects.toThrow("Invalid repo");
  });
});
