import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncHr } from "../sync-hr.js";

const WINDOW_START = "2026-03-01";
const WINDOW_END = "2026-06-30";

interface MockProfile {
  id: string;
  email: string;
}

interface MockLeaveApp {
  id: string;
  employee_id: string;
  leave_type: string;
  manager_approval: string;
  hr_approval: string;
}

interface MockLeaveDay {
  leave_application_id: string;
  leave_date: string;
  is_half_day: boolean;
  half_segment: string | null;
}

interface MockDest {
  developers: { id: string; github_handle: string; email: string }[];
  existingLeaveRows: {
    developer_id: string;
    leave_date: string;
    leave_type: string;
  }[];
}

interface MockSource {
  profiles: MockProfile[];
  leaveApps: MockLeaveApp[];
  leaveDays: MockLeaveDay[];
}

function makeDestSb(cfg: MockDest) {
  const deletes: { developer_id: string; from: string; to: string }[] = [];
  const inserts: any[][] = [];
  let rows = [...cfg.existingLeaveRows];

  const from = vi.fn((table: string) => {
    if (table === "developers") {
      return {
        select: vi.fn(() => Promise.resolve({ data: cfg.developers, error: null })),
      };
    }
    if (table === "developer_leave_days") {
      return {
        delete: vi.fn(() => {
          const state: { devId?: string; gte?: string; lte?: string } = {};
          const chain = {
            eq: vi.fn((col: string, val: string) => {
              if (col === "developer_id") state.devId = val;
              return chain;
            }),
            gte: vi.fn((col: string, val: string) => {
              if (col === "leave_date") state.gte = val;
              return chain;
            }),
            lte: vi.fn((col: string, val: string) => {
              if (col === "leave_date") state.lte = val;
              // terminal — execute the delete + return promise
              deletes.push({
                developer_id: state.devId!,
                from: state.gte!,
                to: state.lte!,
              });
              rows = rows.filter(
                (r) =>
                  !(
                    r.developer_id === state.devId &&
                    r.leave_date >= state.gte! &&
                    r.leave_date <= state.lte!
                  ),
              );
              return Promise.resolve({ data: null, error: null });
            }),
          };
          return chain;
        }),
        insert: vi.fn((batch: any[]) => {
          inserts.push(batch);
          rows = rows.concat(batch);
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }
    throw new Error(`unexpected dest table: ${table}`);
  });

  return {
    sb: { from } as any,
    deletes,
    inserts,
    rows: () => rows,
  };
}

function makeSourceSb(cfg: MockSource) {
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn(() => {
          const state: { emails?: string[] } = {};
          const chain = {
            in: vi.fn((col: string, vals: string[]) => {
              if (col === "email") state.emails = vals;
              return Promise.resolve({
                data: cfg.profiles.filter((p) =>
                  (state.emails ?? []).includes(p.email),
                ),
                error: null,
              });
            }),
          };
          return chain;
        }),
      };
    }
    if (table === "leave_applications") {
      return {
        select: vi.fn(() => {
          const state: { empIds?: string[] } = {};
          const chain = {
            in: vi.fn((col: string, vals: string[]) => {
              if (col === "employee_id") state.empIds = vals;
              return chain;
            }),
            eq: vi.fn(() => chain),
            then: undefined as any,
          };
          const finalQuery = (): Promise<{ data: any[]; error: any }> => {
            const filtered = cfg.leaveApps.filter(
              (l) =>
                (state.empIds ?? []).includes(l.employee_id) &&
                l.manager_approval === "approved" &&
                l.hr_approval === "approved",
            );
            return Promise.resolve({ data: filtered, error: null });
          };
          // Return chain that yields rows on second eq() call (matches real PostgREST usage)
          chain.eq = vi.fn((col: string, _val: string) => {
            const c2: any = {
              eq: vi.fn(() => finalQuery()),
            };
            return c2;
          });
          return chain;
        }),
      };
    }
    if (table === "leave_application_days") {
      return {
        select: vi.fn(() => {
          const state: { appIds?: string[]; gte?: string; lte?: string } = {};
          const chain = {
            in: vi.fn((col: string, vals: string[]) => {
              if (col === "leave_application_id") state.appIds = vals;
              return chain;
            }),
            gte: vi.fn((col: string, val: string) => {
              if (col === "leave_date") state.gte = val;
              return chain;
            }),
            lte: vi.fn((col: string, val: string) => {
              if (col === "leave_date") state.lte = val;
              // terminal — execute
              const rows = cfg.leaveDays.filter(
                (d) =>
                  (state.appIds ?? []).includes(d.leave_application_id) &&
                  d.leave_date >= state.gte! &&
                  d.leave_date <= state.lte!,
              );
              return Promise.resolve({ data: rows, error: null });
            }),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected source table: ${table}`);
  });

  return { sb: { from } as any };
}

const BASE_DEVS = [
  { id: "dev-alice", github_handle: "alice", email: "alice@team.com" },
  { id: "dev-bob", github_handle: "bob", email: "bob@team.com" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncHr", () => {
  it("happy path: maps approved leaves through email → profile → leave days → upsert", async () => {
    const dest = makeDestSb({ developers: BASE_DEVS, existingLeaveRows: [] });
    const source = makeSourceSb({
      profiles: [
        { id: "profile-alice", email: "alice@team.com" },
        { id: "profile-bob", email: "bob@team.com" },
      ],
      leaveApps: [
        {
          id: "leave-1",
          employee_id: "profile-alice",
          leave_type: "Ordinary Leave (OL)",
          manager_approval: "approved",
          hr_approval: "approved",
        },
        {
          id: "leave-2",
          employee_id: "profile-bob",
          leave_type: "Medical Leave",
          manager_approval: "approved",
          hr_approval: "approved",
        },
      ],
      leaveDays: [
        {
          leave_application_id: "leave-1",
          leave_date: "2026-04-15",
          is_half_day: false,
          half_segment: null,
        },
        {
          leave_application_id: "leave-2",
          leave_date: "2026-05-10",
          is_half_day: true,
          half_segment: "AM",
        },
      ],
    });

    const result = await syncHr({
      destSb: dest.sb,
      sourceSb: source.sb,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(result.developers_processed).toBe(2);
    expect(result.leave_days_synced).toBe(2);
    expect(result.developers_skipped_no_profile).toBe(0);

    // Each dev should get one delete (window clear) + one insert (current rows)
    expect(dest.deletes).toHaveLength(2);
    expect(dest.inserts).toHaveLength(2);

    const flat = dest.inserts.flat();
    expect(flat).toHaveLength(2);
    const alice = flat.find((r) => r.developer_id === "dev-alice");
    expect(alice).toMatchObject({
      developer_id: "dev-alice",
      leave_date: "2026-04-15",
      leave_type: "Ordinary Leave (OL)",
      is_half_day: false,
      source_leave_application_id: "leave-1",
    });
    const bob = flat.find((r) => r.developer_id === "dev-bob");
    expect(bob).toMatchObject({
      developer_id: "dev-bob",
      leave_date: "2026-05-10",
      leave_type: "Medical Leave",
      is_half_day: true,
      half_segment: "AM",
    });
  });

  it("filters out non-approved leaves (pending manager OR rejected HR)", async () => {
    const dest = makeDestSb({ developers: BASE_DEVS, existingLeaveRows: [] });
    const source = makeSourceSb({
      profiles: [{ id: "profile-alice", email: "alice@team.com" }],
      leaveApps: [
        {
          id: "leave-pending",
          employee_id: "profile-alice",
          leave_type: "OL",
          manager_approval: "pending",
          hr_approval: "approved",
        },
        {
          id: "leave-rejected",
          employee_id: "profile-alice",
          leave_type: "OL",
          manager_approval: "approved",
          hr_approval: "rejected",
        },
      ],
      leaveDays: [
        {
          leave_application_id: "leave-pending",
          leave_date: "2026-04-15",
          is_half_day: false,
          half_segment: null,
        },
        {
          leave_application_id: "leave-rejected",
          leave_date: "2026-04-16",
          is_half_day: false,
          half_segment: null,
        },
      ],
    });

    const result = await syncHr({
      destSb: dest.sb,
      sourceSb: source.sb,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(result.leave_days_synced).toBe(0);
    expect(dest.inserts.flat()).toHaveLength(0);
  });

  it("skips developer with no matching profile in source", async () => {
    const dest = makeDestSb({
      developers: [
        { id: "dev-alice", github_handle: "alice", email: "alice@team.com" },
        { id: "dev-ghost", github_handle: "ghost", email: "ghost@team.com" },
      ],
      existingLeaveRows: [],
    });
    const source = makeSourceSb({
      profiles: [{ id: "profile-alice", email: "alice@team.com" }],
      leaveApps: [],
      leaveDays: [],
    });

    const result = await syncHr({
      destSb: dest.sb,
      sourceSb: source.sb,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(result.developers_processed).toBe(1);
    expect(result.developers_skipped_no_profile).toBe(1);
  });

  it("delete-then-insert: removes stale rows in window before insert", async () => {
    const dest = makeDestSb({
      developers: [BASE_DEVS[0]!],
      existingLeaveRows: [
        // stale row: previously approved, now rejected (should disappear)
        {
          developer_id: "dev-alice",
          leave_date: "2026-04-10",
          leave_type: "OL",
        },
      ],
    });
    const source = makeSourceSb({
      profiles: [{ id: "profile-alice", email: "alice@team.com" }],
      leaveApps: [
        {
          id: "leave-new",
          employee_id: "profile-alice",
          leave_type: "OL",
          manager_approval: "approved",
          hr_approval: "approved",
        },
      ],
      leaveDays: [
        {
          leave_application_id: "leave-new",
          leave_date: "2026-04-20",
          is_half_day: false,
          half_segment: null,
        },
      ],
    });

    await syncHr({
      destSb: dest.sb,
      sourceSb: source.sb,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    const final = dest.rows();
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({
      leave_date: "2026-04-20",
    });
    // Stale 2026-04-10 should be gone
    expect(final.find((r) => r.leave_date === "2026-04-10")).toBeUndefined();
  });

  it("dev with no leaves in window: clears stale window rows, inserts nothing", async () => {
    const dest = makeDestSb({
      developers: [BASE_DEVS[0]!],
      existingLeaveRows: [
        {
          developer_id: "dev-alice",
          leave_date: "2026-04-10",
          leave_type: "OL",
        },
      ],
    });
    const source = makeSourceSb({
      profiles: [{ id: "profile-alice", email: "alice@team.com" }],
      leaveApps: [],
      leaveDays: [],
    });

    await syncHr({
      destSb: dest.sb,
      sourceSb: source.sb,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(dest.deletes).toHaveLength(1);
    expect(dest.inserts.flat()).toHaveLength(0);
    expect(dest.rows()).toHaveLength(0); // stale row deleted
  });
});
