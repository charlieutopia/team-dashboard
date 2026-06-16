import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDaily, selectBranchesForAnalysis } from "../run-daily.js";
import type { DailyReport } from "@team-dashboard/shared";

const KL_DATE = "2026-05-10";
const REPO_FULL = "utopiabuilder/utopiaspace";
const SPEC_MODULE = "team-dashboard";
const REPO_ID = "repo-uuid-1";
const DEFAULT_BRANCH = "development";
const DEFAULT_BRANCH_SHA = "base-sha-default";

interface DiffByBranch {
  files: { filename: string; patch: string; status: string }[];
  commits: {
    sha: string;
    message: string;
    author_login: string | null;
    committed_at?: string | null;
  }[];
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

interface MockOrgRepo {
  full_name: string;
  pushed_at?: string | null;
  archived?: boolean;
  disabled?: boolean;
}

interface MockOctokitOpts {
  branches: MockBranch[];
  diffByBranch: Record<string, DiffByBranch>;
  /** PRs returned by search.issuesAndPullRequests, keyed by author handle */
  prsByAuthor?: Record<string, MockPr[]>;
  /**
   * Repos returned by orgs.listRepos. Defaults to a single live repo
   * (REPO_FULL, pushed now) so existing tests keep their one-repo behaviour.
   * Per-repo branch sets default to `opts.branches` when `branchesByRepo` is
   * not given (single-repo tests stay unchanged).
   */
  orgRepos?: MockOrgRepo[];
  /** branches keyed by repo full_name, for multi-repo tests */
  branchesByRepo?: Record<string, MockBranch[]>;
  /** GitHub profile names keyed by handle, for getByUsername */
  profileNamesByHandle?: Record<string, string | null>;
}

function makeMockOctokit(opts: MockOctokitOpts) {
  // Default to a single live repo so existing one-repo tests are unchanged.
  const orgRepos: MockOrgRepo[] = opts.orgRepos ?? [
    { full_name: REPO_FULL, pushed_at: new Date().toISOString() },
  ];
  // Per-repo branch sets: explicit map wins, else every repo gets opts.branches.
  const branchesForRepo = (fullName: string): MockBranch[] => {
    if (opts.branchesByRepo) return opts.branchesByRepo[fullName] ?? [];
    return opts.branches;
  };
  // Flat union of all branches across all repos — head SHAs are globally unique
  // so compareCommits can resolve a branch by head SHA without knowing the repo.
  const allBranches: MockBranch[] = opts.branchesByRepo
    ? Object.values(opts.branchesByRepo).flat()
    : opts.branches;

  const compareCommits = vi.fn(
    async ({ base, head }: { base: string; head: string }) => {
      const branchEntry = allBranches.find((b) => b.sha === head);
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
            commit: {
              message: c.message,
              // getDiffBetweenCommits reads commit.author.date for committed_at.
              // Default to a recent timestamp so since-filter treats branches as
              // in-window unless a test sets an explicit older committed_at.
              author: {
                date: c.committed_at ?? new Date().toISOString(),
              },
            },
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

  // GitHub profile lookup for auto-discovery. Returns the configured name or
  // null (handle-only fallback) per the missing handle.
  const getByUsername = vi.fn(async ({ username }: { username: string }) => {
    const name = (opts.profileNamesByHandle ?? {})[username] ?? null;
    return { data: { name } } as any;
  });

  // paginate.iterator drives two endpoints:
  //   - octokit.orgs.listRepos (args carry `org`) → yield org repos
  //   - octokit.repos.listBranches (args carry `owner`/`repo`) → yield branches
  const paginateIterator = vi.fn((_fn: any, args: any) => {
    if (args && typeof args.org === "string") {
      return (async function* () {
        yield {
          data: orgRepos.map((r) => ({
            full_name: r.full_name,
            pushed_at:
              r.pushed_at === undefined ? new Date().toISOString() : r.pushed_at,
            archived: r.archived ?? false,
            disabled: r.disabled ?? false,
          })),
        };
      })();
    }
    const fullName = `${args.owner}/${args.repo}`;
    const branches = branchesForRepo(fullName);
    return (async function* () {
      yield {
        data: branches.map((b) => ({
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
    orgs: {
      listRepos: vi.fn(),
    },
    users: {
      getByUsername,
    },
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
  const developerUpsertCalls: any[] = [];
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
        // Step 0 ended-developer auto-flip:
        //   .update({ active: false }).lt("end_date", klDate)
        //     .not("end_date", "is", null).eq("active", true).select("id")
        // No dev in the test fixtures carries an end_date, so the flip matches
        // zero rows. The chain just needs to resolve to an empty result.
        update: vi.fn(() => {
          const result = Promise.resolve({ data: [], error: null });
          const chain: any = {
            lt: vi.fn(() => chain),
            not: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            select: vi.fn(() => result),
          };
          return chain;
        }),
        // Auto-discover insert path:
        //   .upsert({ github_handle, display_name, email, active, auto_discovered },
        //           { onConflict: "github_handle", ignoreDuplicates: true })
        //     .select("id, display_name").maybeSingle()
        // The mock mints a deterministic id, records the row, and makes it
        // visible to the later .eq("active", true) sync queries.
        upsert: vi.fn((row: any) => {
          const id = `auto-${row.github_handle}`;
          developerUpsertCalls.push(row);
          developersByHandle[row.github_handle] = {
            id,
            display_name: row.display_name ?? null,
            active: row.active ?? true,
          };
          return {
            select: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { id, display_name: row.display_name ?? null },
                  error: null,
                }),
              ),
            })),
          };
        }),
        select: vi.fn((cols: string) => {
          // Three access patterns:
          // (a) .select("id, github_handle, display_name").in("github_handle", [..])
          //     — bulk existence lookup for the handles seen this run
          // (b) .select("id, display_name").eq("github_handle", X).maybeSingle()
          //     — single re-read after an ignoreDuplicates upsert
          // (c) .select("id, github_handle").eq("active", true) — all active devs
          //     (used by the active-branches + open-PRs sync steps)
          const inFn = vi.fn((col: string, vals: string[]) => {
            const rows = vals
              .filter((h) => developersByHandle[h])
              .map((h) => ({
                id: developersByHandle[h]!.id,
                github_handle: h,
                display_name: developersByHandle[h]!.display_name ?? null,
              }));
            return Promise.resolve({ data: rows, error: null });
          });
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
            // Default: handle-resolve path (re-read after upsert)
            return {
              maybeSingle: vi.fn(() => {
                const row = developersByHandle[val];
                return Promise.resolve({
                  data: row
                    ? { id: row.id, display_name: row.display_name ?? null }
                    : null,
                  error: null,
                });
              }),
            };
          });
          return { eq: eqFn, in: inFn };
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
    developerUpsertCalls,
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
      developers_auto_discovered: 0,
      reports_skipped_stale: 0,
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

  it("auto-discover: unknown handle is inserted then analyzed", async () => {
    const { sb, upsertCalls, developerUpsertCalls } = makeMockSb({
      developersByHandle: {}, // empty — handle is unknown
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/x", sha: "head-x" }],
      diffByBranch: {
        "feat/x": {
          files: [],
          commits: [
            {
              sha: "c1",
              message: "wip",
              author_login: "newcontributor",
            },
          ],
        },
      },
      profileNamesByHandle: { newcontributor: "New Contributor" },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({
      sb,
      octokit,
      analyze,
      klDate: KL_DATE,
    });

    // The unknown handle is auto-discovered, not skipped.
    expect(result.skipped_no_developer).toBe(0);
    expect(result.developers_auto_discovered).toBe(1);
    expect(result.developers_analyzed).toBe(1);
    expect(result.reports_succeeded).toBe(1);

    // A minimal developers row was inserted with the required NOT-NULL fields.
    expect(developerUpsertCalls).toHaveLength(1);
    const inserted = developerUpsertCalls[0]!;
    expect(inserted.github_handle).toBe("newcontributor");
    expect(inserted.display_name).toBe("New Contributor");
    expect(inserted.email).toBe(
      "newcontributor@users.noreply.github.com",
    );
    expect(inserted.active).toBe(true);
    expect(inserted.auto_discovered).toBe(true);

    // getByUsername is only called for the missing handle.
    expect(octokit.users.getByUsername).toHaveBeenCalledTimes(1);
    expect(octokit.users.getByUsername).toHaveBeenCalledWith({
      username: "newcontributor",
    });

    // The discovered dev gets a real report.
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.row.developer_id).toBe("auto-newcontributor");
  });

  it("auto-discover fallback: no profile name uses the handle as display_name", async () => {
    const { sb, developerUpsertCalls } = makeMockSb({
      developersByHandle: {},
    });
    const octokit = makeMockOctokit({
      branches: [{ name: "feat/x", sha: "head-x" }],
      diffByBranch: {
        "feat/x": {
          files: [],
          commits: [{ sha: "c1", message: "wip", author_login: "ghost" }],
        },
      },
      profileNamesByHandle: { ghost: null }, // profile has no name
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    expect(developerUpsertCalls).toHaveLength(1);
    expect(developerUpsertCalls[0]!.display_name).toBe("ghost");
  });

  it("existing dev: getByUsername is NOT called when the handle is known", async () => {
    const { sb, developerUpsertCalls } = makeMockSb({
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
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    expect(developerUpsertCalls).toHaveLength(0);
    expect(octokit.users.getByUsername).not.toHaveBeenCalled();
  });

  it("org enumeration: archived, disabled, and stale repos are skipped", async () => {
    const { sb, branchInsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const octokit = makeMockOctokit({
      branches: [],
      orgRepos: [
        { full_name: "utopiabuilder/live", pushed_at: now.toISOString() },
        {
          full_name: "utopiabuilder/archived",
          pushed_at: now.toISOString(),
          archived: true,
        },
        {
          full_name: "utopiabuilder/disabled",
          pushed_at: now.toISOString(),
          disabled: true,
        },
        { full_name: "utopiabuilder/stale", pushed_at: old },
      ],
      branchesByRepo: {
        "utopiabuilder/live": [{ name: "feat/a", sha: "head-a" }],
        "utopiabuilder/archived": [{ name: "feat/b", sha: "head-b" }],
        "utopiabuilder/disabled": [{ name: "feat/c", sha: "head-c" }],
        "utopiabuilder/stale": [{ name: "feat/d", sha: "head-d" }],
      },
      diffByBranch: {
        "feat/a": {
          files: [{ filename: "src/a.ts", patch: "+a", status: "modified" }],
          commits: [
            {
              sha: "c1",
              message: "live work",
              author_login: "alice",
            },
          ],
        },
        // feat/b/c/d should never be diffed — their repos are filtered out.
        "feat/b": {
          files: [],
          commits: [{ sha: "c2", message: "x", author_login: "alice" }],
        },
        "feat/c": {
          files: [],
          commits: [{ sha: "c3", message: "y", author_login: "alice" }],
        },
        "feat/d": {
          files: [],
          commits: [{ sha: "c4", message: "z", author_login: "alice" }],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    // Only the live repo's branch is enumerated + synced.
    expect(result.branches_synced).toBe(1);
    expect(branchInsertCalls).toHaveLength(1);
    const rows = branchInsertCalls[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repo_full_name).toBe("utopiabuilder/live");
    expect(rows[0]!.branch_name).toBe("feat/a");
    // compareCommits was called once (only the live branch).
    expect(octokit.repos.compareCommits).toHaveBeenCalledTimes(1);
  });

  it("cross-repo grouping: one dev with branches in two repos → ONE analyze call covering both", async () => {
    const { sb, upsertCalls, branchInsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const now = new Date().toISOString();
    const octokit = makeMockOctokit({
      branches: [],
      orgRepos: [
        { full_name: "utopiabuilder/repo-one", pushed_at: now },
        { full_name: "utopiabuilder/repo-two", pushed_at: now },
      ],
      branchesByRepo: {
        "utopiabuilder/repo-one": [{ name: "feat/one", sha: "head-one" }],
        "utopiabuilder/repo-two": [{ name: "fix/two", sha: "head-two" }],
      },
      diffByBranch: {
        "feat/one": {
          files: [{ filename: "a.ts", patch: "+a", status: "modified" }],
          commits: [
            { sha: "c1", message: "one", author_login: "alice" },
          ],
        },
        "fix/two": {
          files: [{ filename: "b.ts", patch: "+b", status: "modified" }],
          commits: [
            { sha: "c2", message: "two", author_login: "alice" },
          ],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    // ONE report per dev across repos.
    expect(result.developers_analyzed).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.row.developer_id).toBe("dev-alice");

    // The single analyze input carries BOTH branches, each tagged with its repo.
    const input = analyze.mock.calls[0]![0];
    expect(input.branches).toHaveLength(2);
    const repoNames = input.branches
      .map((b: any) => b.repo_full_name)
      .sort();
    expect(repoNames).toEqual([
      "utopiabuilder/repo-one",
      "utopiabuilder/repo-two",
    ]);
    // No spec text is passed in the org-wide path.
    expect(input.spec_text).toBeUndefined();

    // Both branches land in the active-branches sync, one row per (repo,branch).
    expect(result.branches_synced).toBe(2);
    const rows = branchInsertCalls[0]!;
    const syncedRepos = rows.map((r: any) => r.repo_full_name).sort();
    expect(syncedRepos).toEqual([
      "utopiabuilder/repo-one",
      "utopiabuilder/repo-two",
    ]);
  });

  it("since-filter: dev whose branches are all older than the window is NOT analyzed but still synced", async () => {
    const { sb, upsertCalls, branchInsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const now = new Date().toISOString();
    // Last commit far older than the default 3-day window.
    const staleCommit = new Date(
      Date.now() - 30 * 24 * 3600 * 1000,
    ).toISOString();
    const octokit = makeMockOctokit({
      orgRepos: [{ full_name: "utopiabuilder/live", pushed_at: now }],
      branchesByRepo: {
        "utopiabuilder/live": [{ name: "feat/old", sha: "head-old" }],
      },
      branches: [],
      diffByBranch: {
        "feat/old": {
          files: [{ filename: "a.ts", patch: "+a", status: "modified" }],
          commits: [
            {
              sha: "c1",
              message: "old work",
              author_login: "alice",
              committed_at: staleCommit,
            } as any,
          ],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    // No AI call, counted as stale.
    expect(analyze).not.toHaveBeenCalled();
    expect(result.developers_analyzed).toBe(0);
    expect(result.reports_skipped_stale).toBe(1);
    expect(upsertCalls).toHaveLength(0);

    // Branch metadata still syncs.
    expect(result.branches_synced).toBe(1);
    expect(branchInsertCalls[0]![0]!.branch_name).toBe("feat/old");
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
      developers_auto_discovered: 0,
      reports_skipped_stale: 0,
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

  it("branch cap: dev with >6 branches — only the 6 newest go into the AI prompt, ALL sync", async () => {
    const { sb, branchInsertCalls } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const now = new Date().toISOString();
    // 9 branches in one repo. committed_at decreases with the index, so b0 is
    // newest and b8 is oldest. The newest 6 (b0..b5) should reach the prompt.
    const branchNames = Array.from({ length: 9 }, (_, i) => `feat/b${i}`);
    const branchesByRepo: Record<string, MockBranch[]> = {
      "utopiabuilder/repo": branchNames.map((name, i) => ({
        name,
        sha: `head-${i}`,
      })),
    };
    const diffByBranch: Record<string, DiffByBranch> = {};
    branchNames.forEach((name, i) => {
      // Newest first: b0 = now, each later branch is i hours older.
      const committed = new Date(
        Date.now() - i * 3600 * 1000,
      ).toISOString();
      diffByBranch[name] = {
        files: [{ filename: `src/${name}.ts`, patch: "+x", status: "modified" }],
        commits: [
          {
            sha: `c-${i}`,
            message: `work ${i}`,
            author_login: "alice",
            committed_at: committed,
          } as any,
        ],
      };
    });
    const octokit = makeMockOctokit({
      branches: [],
      orgRepos: [{ full_name: "utopiabuilder/repo", pushed_at: now }],
      branchesByRepo,
      diffByBranch,
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    const result = await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    // AI prompt sees only the 6 newest branches.
    expect(analyze).toHaveBeenCalledTimes(1);
    const promptBranches = analyze.mock.calls[0]![0].branches as any[];
    expect(promptBranches).toHaveLength(6);
    const promptNames = promptBranches.map((b) => b.branch_name).sort();
    expect(promptNames).toEqual([
      "feat/b0",
      "feat/b1",
      "feat/b2",
      "feat/b3",
      "feat/b4",
      "feat/b5",
    ]);
    // The 3 oldest branches are dropped from the prompt only.
    expect(promptNames).not.toContain("feat/b8");

    // But ALL 9 branches still sync to developer_active_branches.
    expect(result.branches_synced).toBe(9);
    expect(branchInsertCalls[0]!).toHaveLength(9);
  });

  it("total-diff cap: combined prompt diff stays under the char budget; overflow branch truncated, rest emptied", async () => {
    const { sb } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const now = new Date().toISOString();
    // 3 branches, each carrying a ~25KB per-branch diff (under the 30KB
    // per-branch cap, so each arrives full). With the default 60000-char total
    // budget: branch 1 (25KB) fits, branch 2 (25KB) fits (50KB total), branch 3
    // overflows → truncated; nothing dropped past it here (only 3 branches).
    const bigPatch = "a".repeat(25_000);
    const branchNames = ["feat/n0", "feat/n1", "feat/n2"];
    const branchesByRepo: Record<string, MockBranch[]> = {
      "utopiabuilder/repo": branchNames.map((name, i) => ({
        name,
        sha: `head-${i}`,
      })),
    };
    const diffByBranch: Record<string, DiffByBranch> = {};
    branchNames.forEach((name, i) => {
      const committed = new Date(Date.now() - i * 3600 * 1000).toISOString();
      diffByBranch[name] = {
        files: [{ filename: `src/${name}.ts`, patch: bigPatch, status: "modified" }],
        commits: [
          {
            sha: `c-${i}`,
            message: `work ${i}`,
            author_login: "alice",
            committed_at: committed,
          } as any,
        ],
      };
    });
    const octokit = makeMockOctokit({
      branches: [],
      orgRepos: [{ full_name: "utopiabuilder/repo", pushed_at: now }],
      branchesByRepo,
      diffByBranch,
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    const promptBranches = analyze.mock.calls[0]![0].branches as any[];
    // All 3 branches still present (count <= 6), but combined diff is bounded.
    expect(promptBranches).toHaveLength(3);
    const totalDiffChars = promptBranches.reduce(
      (sum, b) => sum + (b.diff_text?.length ?? 0),
      0,
    );
    // Combined diff must not exceed the 60000-char default budget.
    expect(totalDiffChars).toBeLessThanOrEqual(60_000);
    // The overflowing branch carries the truncation marker.
    const truncated = promptBranches.filter((b) =>
      (b.diff_text ?? "").endsWith("...(diff truncated)"),
    );
    expect(truncated.length).toBeGreaterThanOrEqual(1);
  });

  it("small input unchanged: few small branches pass through with full diffs", async () => {
    const { sb } = makeMockSb({
      developersByHandle: { alice: { id: "dev-alice" } },
    });
    const octokit = makeMockOctokit({
      branches: [
        { name: "feat/a", sha: "head-a" },
        { name: "fix/b", sha: "head-b" },
      ],
      diffByBranch: {
        "feat/a": {
          files: [{ filename: "src/a.ts", patch: "+small", status: "modified" }],
          commits: [{ sha: "c1", message: "x", author_login: "alice" }],
        },
        "fix/b": {
          files: [{ filename: "src/b.ts", patch: "+tiny", status: "modified" }],
          commits: [{ sha: "c2", message: "y", author_login: "alice" }],
        },
      },
    });
    const analyze = vi.fn(async (input) => validReport(input.developer_handle));

    await runDaily({ sb, octokit, analyze, klDate: KL_DATE });

    const promptBranches = analyze.mock.calls[0]![0].branches as any[];
    expect(promptBranches).toHaveLength(2);
    // No truncation marker on small diffs.
    for (const b of promptBranches) {
      expect(b.diff_text).not.toContain("...(diff truncated)");
      expect(b.diff_text.length).toBeGreaterThan(0);
    }
  });
});

describe("selectBranchesForAnalysis (exported helper)", () => {
  // Minimal BranchPayload builder — only the fields the selector reads matter;
  // the rest are filled with placeholders so the shape type-checks.
  function payload(
    name: string,
    diff: string,
    lastCommitAt: string | null,
  ): any {
    return {
      branch_name: name,
      head_sha: `head-${name}`,
      base_sha: "base",
      diff_text: diff,
      repo_full_name: "utopiabuilder/repo",
      last_commit_at: lastCommitAt,
      last_commit_message: "msg",
      last_commit_author: "alice",
      commits_ahead: 1,
      lines_added: 1,
      lines_removed: 0,
      files_changed: 1,
    };
  }

  it("keeps only the N most recent branches, newest first", () => {
    const t = (h: number) =>
      new Date(Date.now() - h * 3600 * 1000).toISOString();
    const branches = [
      payload("oldest", "x", t(10)),
      payload("newest", "x", t(0)),
      payload("middle", "x", t(5)),
    ];
    const out = selectBranchesForAnalysis(branches, 2, 1_000_000);
    expect(out.map((b) => b.branch_name)).toEqual(["newest", "middle"]);
  });

  it("null last_commit_at sorts last", () => {
    const branches = [
      payload("unknown", "x", null),
      payload("known", "x", new Date().toISOString()),
    ];
    const out = selectBranchesForAnalysis(branches, 5, 1_000_000);
    expect(out.map((b) => b.branch_name)).toEqual(["known", "unknown"]);
  });

  it("enforces the total-diff budget: overflow truncated, later emptied", () => {
    const now = new Date().toISOString();
    const branches = [
      payload("a", "a".repeat(40), now),
      payload("b", "b".repeat(40), now),
      payload("c", "c".repeat(40), now),
    ];
    // Budget 50: a (40) fits → 10 left; b overflows (40 > 10) → truncated to
    // fit + marker, budget spent; c emptied.
    const out = selectBranchesForAnalysis(branches, 5, 50);
    expect(out[0]!.diff_text).toBe("a".repeat(40));
    expect(out[1]!.diff_text.endsWith("...(diff truncated)")).toBe(true);
    expect(out[2]!.diff_text).toBe("");
    const total = out.reduce((s, b) => s + b.diff_text.length, 0);
    // Combined size is bounded near the budget (marker length is the only slack).
    expect(total).toBeLessThanOrEqual(50 + "...(diff truncated)".length);
  });

  it("small input passes through unchanged (no truncation, all branches kept)", () => {
    const now = new Date().toISOString();
    const branches = [
      payload("a", "+small", now),
      payload("b", "+tiny", now),
    ];
    const out = selectBranchesForAnalysis(branches, 6, 60_000);
    expect(out).toHaveLength(2);
    expect(out[0]!.diff_text).toBe("+small");
    expect(out[1]!.diff_text).toBe("+tiny");
  });
});
