import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDaily } from "../run-daily.js";
import type { DailyReport } from "@team-dashboard/shared";

const KL_DATE = "2026-05-10";
const REPO_FULL = "utopiabuilder/utopiaspace";
const SPEC_MODULE = "team-dashboard";
const REPO_ID = "repo-uuid-1";
const DEFAULT_BRANCH = "development";
const DEFAULT_BRANCH_SHA = "base-sha-default";

interface DiffByBranch {
  files: { filename: string; patch: string; status: string }[];
  commits: { sha: string; message: string; author_login: string | null }[];
}

interface MockBranch {
  name: string;
  sha: string;
}

interface MockOctokitOpts {
  branches: MockBranch[];
  diffByBranch: Record<string, DiffByBranch>;
}

function makeMockOctokit(opts: MockOctokitOpts) {
  const compareCommits = vi.fn(
    async ({ base, head }: { base: string; head: string }) => {
      const branchEntry = opts.branches.find((b) => b.sha === head);
      if (!branchEntry) {
        return { data: { files: [], commits: [] } } as any;
      }
      const diff = opts.diffByBranch[branchEntry.name] ?? {
        files: [],
        commits: [],
      };
      return {
        data: {
          files: diff.files,
          commits: diff.commits.map((c) => ({
            sha: c.sha,
            commit: { message: c.message },
            author: c.author_login ? { login: c.author_login } : null,
          })),
        },
      } as any;
    },
  );

  const getBranch = vi.fn(async ({ branch }: { branch: string }) => {
    return { data: { commit: { sha: DEFAULT_BRANCH_SHA } } } as any;
  });

  const getRepo = vi.fn(async () => {
    return { data: { default_branch: DEFAULT_BRANCH } } as any;
  });

  const getContent = vi.fn(async () => {
    const err: any = new Error("Not Found");
    err.status = 404;
    throw err;
  });

  const paginateIterator = vi.fn(() => {
    return (async function* () {
      yield {
        data: opts.branches.map((b) => ({
          name: b.name,
          commit: { sha: b.sha },
        })),
      };
    })();
  });

  return {
    paginate: { iterator: paginateIterator },
    repos: {
      listBranches: vi.fn(),
      get: getRepo,
      getBranch,
      compareCommits,
      getContent,
    },
  } as any;
}

interface MockSbConfig {
  trackedRepos?: { id: string; full_name: string; spec_module: string }[];
  developersByHandle?: Record<string, { id: string; display_name?: string | null }>;
}

function makeMockSb(cfg: MockSbConfig = {}) {
  const upsertCalls: { table: string; row: any; opts: any }[] = [];
  const trackedRepos = cfg.trackedRepos ?? [
    { id: REPO_ID, full_name: REPO_FULL, spec_module: SPEC_MODULE },
  ];
  const developersByHandle = cfg.developersByHandle ?? {};

  const from = vi.fn((table: string) => {
    if (table === "tracked_repos") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({ data: trackedRepos, error: null }),
          ),
        })),
      };
    }
    if (table === "developers") {
      return {
        select: vi.fn(() => {
          const eqState: { handle?: string } = {};
          const eqFn = vi.fn((col: string, val: string) => {
            eqState.handle = val;
            return {
              maybeSingle: vi.fn(() => {
                const row = developersByHandle[eqState.handle ?? ""];
                return Promise.resolve({
                  data: row ?? null,
                  error: null,
                });
              }),
            };
          });
          return { eq: eqFn };
        }),
      };
    }
    if (table === "daily_reports") {
      return {
        upsert: vi.fn((row: any, opts: any) => {
          upsertCalls.push({ table, row, opts });
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { sb: { from } as any, upsertCalls };
}

function validReport(handle: string): DailyReport {
  return {
    developer_handle: handle,
    date: KL_DATE,
    summary: "did stuff",
    metrics: {
      commits_today: 1,
      commits_yesterday: 0,
      lines_added_today: 10,
      lines_removed_today: 2,
      files_touched_today: ["src/foo.ts"],
    },
    spec_progress: { advancing: [], drifting: [] },
    trajectory: "on_track",
    generator_version: "v1+claude-code-headless",
  };
}

describe("runDaily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: 1 dev with 1 branch — upserts a DailyReport", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/x", sha: "head-x" }],
      diffByBranch: {
        "feat/x": {
          files: [
            { filename: "src/foo.ts", patch: "@@ -1 +1 @@\n+hi", status: "modified" },
          ],
          commits: [
            { sha: "c1", message: "wip", author_login: "alice" },
          ],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    expect(result).toEqual({
      developers_analyzed: 1,
      reports_succeeded: 1,
      reports_failed: 0,
      skipped_no_developer: 0,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);
    const call = upsertCalls[0]!;
    expect(call.opts).toEqual({ onConflict: "developer_id,report_date" });
    expect(call.row.developer_id).toBe("dev-alice");
    expect(call.row.report_date).toBe(KL_DATE);
    expect(call.row.parse_failed).toBe(false);
    expect(call.row.summary).toBe("did stuff");
    expect(call.row.error_msg).toBeNull();
  });

  it("failure path: analyze returns AnalyzeFailure — upserts parse_failed row", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/x", sha: "head-x" }],
      diffByBranch: {
        "feat/x": {
          files: [],
          commits: [{ sha: "c1", message: "wip", author_login: "alice" }],
        },
      },
    });
    const analyze = vi.fn(async () => ({
      parse_failed: true as const,
      error_msg: "test failure",
      developer_handle: "alice",
      date: KL_DATE,
    }));

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    expect(result.reports_failed).toBe(1);
    expect(result.reports_succeeded).toBe(0);
    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0]!.row;
    expect(row.parse_failed).toBe(true);
    expect(row.error_msg).toBe("test failure");
    expect(row.summary).toBeNull();
    expect(row.metrics).toBeNull();
    expect(row.spec_progress).toBeNull();
    expect(row.trajectory).toBeNull();
    expect(row.developer_id).toBe("dev-alice");
  });

  it("skip path: developer not in developers table — no analyze, no upsert", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developersByHandle: {}, // empty
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/x", sha: "head-x" }],
      diffByBranch: {
        "feat/x": {
          files: [],
          commits: [
            { sha: "c1", message: "wip", author_login: "unknownuser" },
          ],
        },
      },
    });
    const analyze = vi.fn();

    const result = await runDaily({
      sb,
      octokit,
      analyze: analyze as any,
      klDate: KL_DATE,
    });

    expect(result).toEqual({
      developers_analyzed: 0,
      reports_succeeded: 0,
      reports_failed: 0,
      skipped_no_developer: 1,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it("multi-dev: 2 devs each with 1 branch — analyze called twice, both succeed", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developersByHandle: {
        alice: { id: "dev-alice" },
        bob: { id: "dev-bob" },
      },
    });
    const octokit = makeMockOctokit({
      branches: [
        { name: "feat/a", sha: "head-a" },
        { name: "fix/b", sha: "head-b" },
      ],
      diffByBranch: {
        "feat/a": {
          files: [],
          commits: [{ sha: "c1", message: "x", author_login: "alice" }],
        },
        "fix/b": {
          files: [],
          commits: [{ sha: "c2", message: "y", author_login: "bob" }],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    expect(result).toEqual({
      developers_analyzed: 2,
      reports_succeeded: 2,
      reports_failed: 0,
      skipped_no_developer: 0,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(upsertCalls).toHaveLength(2);
    const ids = upsertCalls.map((c) => c.row.developer_id).sort();
    expect(ids).toEqual(["dev-alice", "dev-bob"]);
  });

  it("throw safety: analyze throws — counted as failure, loop continues", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developersByHandle: {
        alice: { id: "dev-alice" },
        bob: { id: "dev-bob" },
      },
    });
    const octokit = makeMockOctokit({
      branches: [
        { name: "feat/a", sha: "head-a" },
        { name: "fix/b", sha: "head-b" },
      ],
      diffByBranch: {
        "feat/a": {
          files: [],
          commits: [{ sha: "c1", message: "x", author_login: "alice" }],
        },
        "fix/b": {
          files: [],
          commits: [{ sha: "c2", message: "y", author_login: "bob" }],
        },
      },
    });
    let calls = 0;
    const analyze = vi.fn(async (input) => {
      calls++;
      if (input.developer_handle === "alice") {
        throw new Error("network down");
      }
      return validReport(input.developer_handle);
    });

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    expect(calls).toBe(2);
    expect(result.reports_failed).toBe(1);
    expect(result.reports_succeeded).toBe(1);
    expect(upsertCalls).toHaveLength(2);
    const aliceRow = upsertCalls.find((c) => c.row.developer_id === "dev-alice")!;
    expect(aliceRow.row.parse_failed).toBe(true);
    expect(aliceRow.row.error_msg).toContain("network down");
    const bobRow = upsertCalls.find((c) => c.row.developer_id === "dev-bob")!;
    expect(bobRow.row.parse_failed).toBe(false);
  });
});
