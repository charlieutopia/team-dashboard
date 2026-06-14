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

interface MockPr {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  created_at?: string;
  updated_at?: string;
  author: string;
}

interface MockOctokitOpts {
  branches: MockBranch[];
  diffByBranch: Record<string, DiffByBranch>;
  /** PRs returned by search.issuesAndPullRequests, keyed by author handle */
  prsByAuthor?: Record<string, MockPr[]>;
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

  // Phase 3 Step 4: search.issuesAndPullRequests for PR sync.
  // Mock parses the q="is:pr is:open author:X repo:Y" string to find author.
  const issuesAndPullRequests = vi.fn(async ({ q }: { q: string }) => {
    const authorMatch = /author:(\S+)/.exec(q);
    const author = authorMatch ? authorMatch[1] : null;
    if (!author) return { data: { items: [] } } as any;
    const prs = (opts.prsByAuthor ?? {})[author] ?? [];
    return {
      data: {
        items: prs.map((p) => ({
          number: p.number,
          title: p.title,
          html_url: p.html_url,
          draft: p.draft ?? false,
          created_at: p.created_at ?? null,
          updated_at: p.updated_at ?? null,
        })),
      },
    } as any;
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
    search: {
      issuesAndPullRequests,
    },
  } as any;
}

interface MockSbConfig {
  trackedRepos?: { id: string; full_name: string; spec_module: string }[];
  developersByHandle?: Record<
    string,
    { id: string; display_name?: string | null; active?: boolean }
  >;
}

function makeMockSb(cfg: MockSbConfig = {}) {
  const upsertCalls: { table: string; row: any; opts: any }[] = [];
  const branchInsertCalls: any[][] = [];
  const branchDeleteCalls: { in: { col: string; vals: string[] } }[] = [];
  const prInsertCalls: any[][] = [];
  const prDeleteCalls: { in: { col: string; vals: string[] } }[] = [];
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
        select: vi.fn((cols: string) => {
          // Two access patterns:
          // (a) .select("id, display_name").eq("github_handle", X).maybeSingle()
          //     for resolving a handle to a developer row
          // (b) .select("id, github_handle").eq("active", true) — returns all
          //     active devs (used by the active-branches + open-PRs sync steps)
          const eqFn = vi.fn((col: string, val: any) => {
            if (col === "active") {
              // Mirror the real query: .eq("active", true) returns ONLY active
              // devs. A dev with active:false (or any non-true value) is filtered
              // out. Devs that omit the flag default to active (back-compat with
              // tests written before the active flag existed).
              const rows = Object.entries(developersByHandle)
                .filter(([, r]) => {
                  const isActive = (r as { active?: boolean }).active ?? true;
                  return isActive === val;
                })
                .map(([handle, r]) => ({
                  id: (r as { id: string }).id,
                  github_handle: handle,
                }));
              return Promise.resolve({ data: rows, error: null });
            }
            // Default: handle-resolve path
            return {
              maybeSingle: vi.fn(() => {
                const row = developersByHandle[val];
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
    if (table === "developer_active_branches") {
      return {
        delete: vi.fn(() => ({
          in: vi.fn((col: string, vals: string[]) => {
            branchDeleteCalls.push({ in: { col, vals } });
            return Promise.resolve({ data: null, error: null });
          }),
          neq: vi.fn((col: string, val: string) => {
            // snapshot-delete sentinel — record as a delete-all
            branchDeleteCalls.push({ in: { col, vals: [val] } });
            return Promise.resolve({ data: null, error: null });
          }),
        })),
        insert: vi.fn((rows: any[]) => {
          branchInsertCalls.push(rows);
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    if (table === "developer_open_prs") {
      return {
        delete: vi.fn(() => ({
          in: vi.fn((col: string, vals: string[]) => {
            prDeleteCalls.push({ in: { col, vals } });
            return Promise.resolve({ data: null, error: null });
          }),
        })),
        insert: vi.fn((rows: any[]) => {
          prInsertCalls.push(rows);
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    sb: { from } as any,
    upsertCalls,
    branchInsertCalls,
    branchDeleteCalls,
    prInsertCalls,
    prDeleteCalls,
  };
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
      branches_synced: 1,
      prs_synced: 0,
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
      branches_synced: 0,
      prs_synced: 0,
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
      branches_synced: 2,
      prs_synced: 0,
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

  it("developer_active_branches sync: deletes for active devs + inserts per-branch payload", async () => {
    const { sb, branchInsertCalls, branchDeleteCalls } = makeMockSb({
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
          files: [
            { filename: "src/x.ts", patch: "+x", status: "modified" },
            { filename: "src/y.ts", patch: "+y", status: "added" },
          ],
          commits: [
            { sha: "c1", message: "wip", author_login: "alice" },
          ],
        },
        "fix/b": {
          files: [{ filename: "src/z.ts", patch: "-z", status: "modified" }],
          commits: [{ sha: "c2", message: "fix b", author_login: "bob" }],
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

    expect(result.branches_synced).toBe(2);
    // Single snapshot-delete pass (clears ALL rows so inactive devs' stale
    // rows from prior runs don't conflict with fresh inserts).
    expect(branchDeleteCalls).toHaveLength(1);
    expect(branchDeleteCalls[0]!.in.col).toBe("id");
    expect(branchDeleteCalls[0]!.in.vals).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
    // Single bulk insert with both branches
    expect(branchInsertCalls).toHaveLength(1);
    const inserted = branchInsertCalls[0]!;
    expect(inserted).toHaveLength(2);
    const alice = inserted.find((r: any) => r.developer_id === "dev-alice")!;
    expect(alice.repo_full_name).toBe(REPO_FULL);
    expect(alice.branch_name).toBe("feat/a");
    expect(alice.head_sha).toBe("head-a");
    expect(alice.base_sha).toBe(DEFAULT_BRANCH_SHA);
    expect(alice.commits_ahead).toBe(1);
    expect(alice.files_changed).toBe(2);
    expect(alice.last_commit_message).toBe("wip");
    expect(alice.last_commit_author).toBe("alice");
    const bob = inserted.find((r: any) => r.developer_id === "dev-bob")!;
    expect(bob.branch_name).toBe("fix/b");
    expect(bob.files_changed).toBe(1);
  });

  it("developer_open_prs sync: deletes for active devs + inserts per-PR payload", async () => {
    const { sb, prInsertCalls, prDeleteCalls } = makeMockSb({
      developersByHandle: {
        alice: { id: "dev-alice" },
        bob: { id: "dev-bob" },
      },
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/a", sha: "head-a" }],
      diffByBranch: {
        "feat/a": {
          files: [],
          commits: [{ sha: "c1", message: "wip", author_login: "alice" }],
        },
      },
      prsByAuthor: {
        alice: [
          {
            number: 42,
            title: "feat: ship the thing",
            html_url: "https://github.com/utopiabuilder/utopiaspace/pull/42",
            draft: false,
            updated_at: "2026-05-12T10:00:00Z",
            created_at: "2026-05-10T10:00:00Z",
            author: "alice",
          },
          {
            number: 43,
            title: "wip: draft prep",
            html_url: "https://github.com/utopiabuilder/utopiaspace/pull/43",
            draft: true,
            updated_at: "2026-05-13T10:00:00Z",
            created_at: "2026-05-13T10:00:00Z",
            author: "alice",
          },
        ],
        // bob: no PRs
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    expect(result.prs_synced).toBe(2);
    expect(prDeleteCalls).toHaveLength(1);
    expect(prDeleteCalls[0]!.in.col).toBe("developer_id");
    expect(prDeleteCalls[0]!.in.vals.sort()).toEqual(["dev-alice", "dev-bob"]);
    expect(prInsertCalls).toHaveLength(1);
    const inserted = prInsertCalls[0]!;
    expect(inserted).toHaveLength(2);
    const open = inserted.find((r: any) => r.pr_number === 42)!;
    expect(open.developer_id).toBe("dev-alice");
    expect(open.pr_state).toBe("open");
    expect(open.pr_title).toBe("feat: ship the thing");
    expect(open.repo_full_name).toBe(REPO_FULL);
    const draft = inserted.find((r: any) => r.pr_number === 43)!;
    expect(draft.pr_state).toBe("draft");
  });

  it("active-only sync: inactive dev's branches and PRs are NOT inserted", async () => {
    const { sb, branchInsertCalls, prInsertCalls } = makeMockSb({
      developersByHandle: {
        alice: { id: "dev-alice", active: true },
        carol: { id: "dev-carol", active: false },
      },
    });
    const octokit = makeMockOctokit({
      branches: [
        { name: "feat/a", sha: "head-a" },
        { name: "feat/c", sha: "head-c" },
      ],
      diffByBranch: {
        "feat/a": {
          files: [{ filename: "src/a.ts", patch: "+a", status: "modified" }],
          commits: [{ sha: "c1", message: "alice work", author_login: "alice" }],
        },
        "feat/c": {
          files: [{ filename: "src/c.ts", patch: "+c", status: "modified" }],
          commits: [{ sha: "c2", message: "carol work", author_login: "carol" }],
        },
      },
      prsByAuthor: {
        alice: [
          {
            number: 10,
            title: "feat: alice ships",
            html_url: "https://github.com/utopiabuilder/utopiaspace/pull/10",
            draft: false,
            updated_at: "2026-05-10T10:00:00Z",
            created_at: "2026-05-10T09:00:00Z",
            author: "alice",
          },
        ],
        carol: [
          {
            number: 11,
            title: "feat: carol ships",
            html_url: "https://github.com/utopiabuilder/utopiaspace/pull/11",
            draft: false,
            updated_at: "2026-05-10T10:00:00Z",
            created_at: "2026-05-10T09:00:00Z",
            author: "carol",
          },
        ],
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    // Only the active dev's branch lands.
    expect(result.branches_synced).toBe(1);
    expect(branchInsertCalls).toHaveLength(1);
    const branchRows = branchInsertCalls[0]!;
    expect(branchRows).toHaveLength(1);
    expect(branchRows[0]!.developer_id).toBe("dev-alice");
    expect(
      branchRows.some((r: any) => r.developer_id === "dev-carol"),
    ).toBe(false);

    // Only the active dev's PR lands.
    expect(result.prs_synced).toBe(1);
    expect(prInsertCalls).toHaveLength(1);
    const prRows = prInsertCalls[0]!;
    expect(prRows).toHaveLength(1);
    expect(prRows[0]!.developer_id).toBe("dev-alice");
    expect(
      prRows.some((r: any) => r.developer_id === "dev-carol"),
    ).toBe(false);
  });
});
