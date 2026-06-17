import { describe, it, expect, vi, beforeEach } from "vitest";
import { runQuality } from "../run-quality.js";

const WEEK_START = "2026-05-04"; // Monday

interface MockBranchRow {
  files_touched: string[] | null;
  last_commit_at: string | null;
}

interface MockSbConfig {
  developers?: { id: string; github_handle: string; level: string | null }[];
  branchesByDev?: Record<string, MockBranchRow[]>;
}

function makeMockSb(cfg: MockSbConfig = {}) {
  const upsertCalls: { row: any; opts: any }[] = [];
  const developers = cfg.developers ?? [];
  const branchesByDev = cfg.branchesByDev ?? {};

  const from = vi.fn((table: string) => {
    if (table === "developers") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({ data: developers, error: null }),
          ),
        })),
      };
    }
    if (table === "developer_active_branches") {
      return {
        // .select("files_touched, last_commit_at")
        //   .eq("developer_id", id).gte("last_commit_at", gte).lt(..., lt)
        select: vi.fn(() => {
          const state: { devId?: string } = {};
          const chain = {
            eq: vi.fn((col: string, val: string) => {
              if (col === "developer_id") state.devId = val;
              return chain;
            }),
            gte: vi.fn(() => chain),
            lt: vi.fn(() =>
              Promise.resolve({
                data: branchesByDev[state.devId ?? ""] ?? [],
                error: null,
              }),
            ),
          };
          return chain;
        }),
      };
    }
    if (table === "weekly_quality_reports") {
      return {
        upsert: vi.fn((row: any, opts: any) => {
          upsertCalls.push({ row, opts });
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    sb: { from } as any,
    upsertCalls,
  };
}

// A branch row with the given files, last commit fixed inside the week window.
function branch(files: string[]): MockBranchRow {
  return { files_touched: files, last_commit_at: "2026-05-06T08:00:00Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runQuality", () => {
  it("mixed branches → solid band upserted with level + scanner_version", async () => {
    // alice: 1 covered (src + test), 1 uncovered (src only) → 1/2 = 50% = solid.
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", level: "mid" },
      ],
      branchesByDev: {
        "dev-alice": [
          branch(["src/foo.ts", "src/__tests__/foo.test.ts"]),
          branch(["src/bar.ts"]),
        ],
      },
    });

    const result = await runQuality({ sb, weekStart: WEEK_START });

    expect(result.developers).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0]!.row;
    expect(row.developer_id).toBe("dev-alice");
    expect(row.week_start_date).toBe(WEEK_START);
    expect(row.test_discipline_band).toBe("solid");
    expect(row.test_discipline_evidence).toBe(
      "1 of 2 code branches shipped with tests (50%)",
    );
    expect(row.level_snapshot).toBe("mid");
    expect(row.scanner_version).toBe("v2+quality-ai");
    // Other dimensions are left untouched (null) in this build.
    expect(row.stability_band).toBeUndefined();
    expect(upsertCalls[0]!.opts).toEqual({
      onConflict: "developer_id,week_start_date",
    });
  });

  it("all code branches tested → strong band", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [{ id: "dev-eve", github_handle: "eve", level: "senior" }],
      branchesByDev: {
        "dev-eve": [
          branch(["src/a.ts", "src/a.test.ts"]),
          branch(["src/b.ts", "src/b.spec.ts"]),
        ],
      },
    });

    const result = await runQuality({ sb, weekStart: WEEK_START });

    expect(result.succeeded).toBe(1);
    expect(upsertCalls[0]!.row.test_discipline_band).toBe("strong");
    expect(upsertCalls[0]!.row.test_discipline_evidence).toBe(
      "2 of 2 code branches shipped with tests (100%)",
    );
    expect(upsertCalls[0]!.row.level_snapshot).toBe("senior");
  });

  it("no code branches → skipped band still upserted", async () => {
    // bob only touched docs/config — no source files anywhere.
    const { sb, upsertCalls } = makeMockSb({
      developers: [{ id: "dev-bob", github_handle: "bob", level: null }],
      branchesByDev: {
        "dev-bob": [branch(["README.md", "config.yaml"])],
      },
    });

    const result = await runQuality({ sb, weekStart: WEEK_START });

    expect(result.developers).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0]!.row;
    expect(row.test_discipline_band).toBe("skipped");
    expect(row.test_discipline_evidence).toBe("no code branches this week");
    expect(row.level_snapshot).toBeNull();
  });

  it("dev with no branches at all → skipped band", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [{ id: "dev-zoe", github_handle: "zoe", level: "junior" }],
      branchesByDev: {}, // zoe has no rows in the window
    });

    const result = await runQuality({ sb, weekStart: WEEK_START });

    expect(result.succeeded).toBe(1);
    expect(upsertCalls[0]!.row.test_discipline_band).toBe("skipped");
  });

  it("multi-dev: each gets one upsert with its own band", async () => {
    const { sb, upsertCalls } = makeMockSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", level: "mid" },
        { id: "dev-bob", github_handle: "bob", level: "junior" },
      ],
      branchesByDev: {
        "dev-alice": [branch(["src/a.ts", "src/a.test.ts"])],
        "dev-bob": [branch(["src/b.ts"])],
      },
    });

    const result = await runQuality({ sb, weekStart: WEEK_START });

    expect(result.developers).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(upsertCalls).toHaveLength(2);
    const alice = upsertCalls.find((c) => c.row.developer_id === "dev-alice")!;
    const bob = upsertCalls.find((c) => c.row.developer_id === "dev-bob")!;
    expect(alice.row.test_discipline_band).toBe("strong");
    expect(bob.row.test_discipline_band).toBe("weak");
  });
});
