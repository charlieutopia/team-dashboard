import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSpecForModule } from "../spec.js";
import type { Octokit } from "@octokit/rest";

describe("getSpecForModule", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getContent: vi.fn(),
      },
    } as any;
  });

  it("returns spec content from utopiaspace", async () => {
    const mockContent = Buffer.from("# Spec Content").toString("base64");
    vi.mocked(mockOctokit.repos.getContent).mockResolvedValue({
      data: {
        type: "file",
        content: mockContent,
      } as any,
    } as any);

    const result = await getSpecForModule(mockOctokit, "reply-box");

    expect(result).toBe("# Spec Content");
    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: "utopiabuilder",
      repo: "utopiaspace",
      path: "openspec/specs/reply-box",
      ref: "development",
    });
  });

  it("recursively fetches markdown files from directory", async () => {
    let callCount = 0;
    vi.mocked(mockOctokit.repos.getContent).mockImplementation(async (opts) => {
      if (callCount === 0) {
        callCount++;
        // Return directory listing
        return {
          data: [
            { type: "file", name: "README.md", path: "openspec/specs/app/README.md" },
            { type: "dir", name: "sections", path: "openspec/specs/app/sections" },
          ],
        } as any;
      } else if (callCount === 1) {
        callCount++;
        // Return file content
        const content = Buffer.from("# README").toString("base64");
        return {
          data: {
            type: "file",
            content,
          } as any,
        } as any;
      } else {
        // Return subdirectory with file
        const content = Buffer.from("## Section").toString("base64");
        return {
          data: {
            type: "file",
            content,
          } as any,
        } as any;
      }
    });

    const result = await getSpecForModule(mockOctokit, "app");

    expect(result).toContain("# README");
  });

  it("handles 404 gracefully with empty string", async () => {
    const error: any = new Error("Not Found");
    error.status = 404;
    vi.mocked(mockOctokit.repos.getContent).mockRejectedValue(error);

    const result = await getSpecForModule(mockOctokit, "nonexistent");

    expect(result).toBe("");
  });

  it("re-throws non-404 errors", async () => {
    const error: any = new Error("API Error");
    error.status = 500;
    vi.mocked(mockOctokit.repos.getContent).mockRejectedValue(error);

    await expect(getSpecForModule(mockOctokit, "app")).rejects.toThrow("API Error");
  });
});
