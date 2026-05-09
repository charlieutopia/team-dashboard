import { describe, it, expect, vi, beforeEach } from "vitest";
import { enumerateActiveBranches } from "../enumerate.js";
import type { Octokit } from "@octokit/rest";

describe("enumerateActiveBranches", () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      paginate: {
        iterator: vi.fn(),
      },
      repos: {
        listBranches: vi.fn(),
      },
    };
  });

  it("filters branches by feature prefixes only", async () => {
    const mockIterator = (function* () {
      yield {
        data: [
          { name: "main", commit: { sha: "abc123" } },
          { name: "wip/feature-a", commit: { sha: "def456" } },
          { name: "feat/feature-b", commit: { sha: "ghi789" } },
          { name: "fix/bug-c", commit: { sha: "jkl012" } },
          { name: "develop", commit: { sha: "mno345" } },
        ],
      };
    })();

    mockOctokit.paginate.iterator.mockReturnValue(mockIterator);

    const result = await enumerateActiveBranches(
      mockOctokit,
      "utopiabuilder/utopia-hub",
    );

    expect(result).toHaveLength(3);
    expect(result.map((b) => b.branch_name)).toEqual([
      "wip/feature-a",
      "feat/feature-b",
      "fix/bug-c",
    ]);
    expect(result[0]).toEqual({
      repo_full_name: "utopiabuilder/utopia-hub",
      branch_name: "wip/feature-a",
      head_sha: "def456",
    });
  });

  it("handles pagination across multiple pages", async () => {
    const mockIterator = (function* () {
      yield {
        data: [{ name: "wip/page1", commit: { sha: "abc123" } }],
      };
      yield {
        data: [{ name: "feat/page2", commit: { sha: "def456" } }],
      };
    })();

    mockOctokit.paginate.iterator.mockReturnValue(mockIterator);

    const result = await enumerateActiveBranches(
      mockOctokit,
      "utopiabuilder/utopia-hub",
    );

    expect(result).toHaveLength(2);
  });

  it("throws on invalid repo name", async () => {
    await expect(
      enumerateActiveBranches(mockOctokit, "invalid-repo"),
    ).rejects.toThrow("Invalid repo full_name");
  });
});
