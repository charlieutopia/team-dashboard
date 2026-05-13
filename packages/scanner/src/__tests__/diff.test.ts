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

    expect(result).toEqual({
      files: [],
      commits: [],
      total_additions: 0,
      total_deletions: 0,
    });
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
            commit: {
              message: "feat: add feature",
              author: { date: "2026-05-12T10:00:00Z" },
            },
            author: { login: "alice" },
          },
          {
            sha: "commit2",
            commit: {
              message: "fix: bug fix",
              author: { date: "2026-05-13T08:00:00Z" },
            },
            author: null,
          },
        ],
        stats: { additions: 12, deletions: 3 },
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
      committed_at: "2026-05-12T10:00:00Z",
    });
    expect(result.commits[1]?.author_login).toBeNull();
    expect(result.commits[1]?.committed_at).toBe("2026-05-13T08:00:00Z");
    expect(result.total_additions).toBe(12);
    expect(result.total_deletions).toBe(3);
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
