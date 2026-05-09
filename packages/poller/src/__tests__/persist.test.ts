import { describe, it, expect, vi, beforeEach } from "vitest";
import { persistReports, persistDrift } from "../persist";
import type { ParsedReport, ParsedDrift } from "../parse";

describe("persistReports", () => {
  it("upserts reports with on conflict", async () => {
    const mockSb = {
      from: vi.fn().mockReturnValue({
        upsert: vi
          .fn()
          .mockResolvedValue({ error: null }),
      }),
    } as any;

    const reports: ParsedReport[] = [
      {
        kind: "report",
        repo_id: "repo-1",
        developer_id: "dev-1",
        date: "2026-05-09",
        raw_summary: "Good day",
        raw_metrics: { commits_today: 3 },
        raw_spec_progress: { advancing: [], drifting: [] },
        raw_trajectory: "on_track",
        generator_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await persistReports(mockSb, reports);

    expect(mockSb.from).toHaveBeenCalledWith("daily_reports");
    expect(mockSb.from().upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          developer_id: "dev-1",
          report_date: "2026-05-09",
          summary: "Good day",
        }),
      ]),
      { onConflict: "developer_id,report_date" },
    );
  });

  it("does nothing for empty reports array", async () => {
    const mockSb = { from: vi.fn() } as any;
    await persistReports(mockSb, []);
    expect(mockSb.from).not.toHaveBeenCalled();
  });

  it("throws on upsert error", async () => {
    const mockSb = {
      from: vi.fn().mockReturnValue({
        upsert: vi
          .fn()
          .mockResolvedValue({ error: new Error("DB error") }),
      }),
    } as any;

    const reports: ParsedReport[] = [
      {
        kind: "report",
        repo_id: "repo-1",
        developer_id: "dev-1",
        date: "2026-05-09",
        raw_summary: "Good day",
        raw_metrics: {},
        raw_spec_progress: { advancing: [], drifting: [] },
        raw_trajectory: "on_track",
        generator_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await expect(persistReports(mockSb, reports)).rejects.toThrow();
  });
});

describe("persistDrift", () => {
  it("resolves developer_id from daily_reports and inserts drift findings", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === "daily_reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ developer_id: "dev-123" }],
                  }),
                }),
            }),
          };
        } else if (table === "drift_findings") {
          return { insert: insertMock };
        }
      }),
    } as any;

    const drifts: ParsedDrift[] = [
      {
        kind: "drift",
        repo_id: "repo-1",
        branch: "main",
        commit_sha: "abc123",
        date: "2026-05-09",
        findings: [
          {
            bucket: "missing",
            spec_item_path: "services/api",
            evidence: "No tests",
          },
        ],
        detector_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await persistDrift(mockSb, drifts);

    expect(insertMock).toHaveBeenCalled();
    const insertCall = insertMock.mock.calls[0][0];
    expect(insertCall).toHaveLength(1);
    expect(insertCall[0]).toMatchObject({
      developer_id: "dev-123",
      report_date: "2026-05-09",
      spec_item_path: "services/api",
      bucket: "missing",
    });
  });

  it("skips drift if developer_id cannot be resolved", async () => {
    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === "daily_reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [],
                  }),
                }),
            }),
          };
        } else if (table === "drift_findings") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
      }),
    } as any;

    const drifts: ParsedDrift[] = [
      {
        kind: "drift",
        repo_id: "repo-1",
        branch: "main",
        commit_sha: "abc123",
        date: "2026-05-09",
        findings: [
          {
            bucket: "missing",
            spec_item_path: "services/api",
            evidence: "No tests",
          },
        ],
        detector_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await persistDrift(mockSb, drifts);

    // drift_findings.insert should not be called if no rows
    expect(mockSb.from("drift_findings").insert).not.toHaveBeenCalled();
  });

  it("inserts one row per finding", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === "daily_reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ developer_id: "dev-456" }],
                  }),
                }),
            }),
          };
        } else if (table === "drift_findings") {
          return { insert: insertMock };
        }
      }),
    } as any;

    const drifts: ParsedDrift[] = [
      {
        kind: "drift",
        repo_id: "repo-1",
        branch: "main",
        commit_sha: "abc",
        date: "2026-05-09",
        findings: [
          {
            bucket: "missing",
            spec_item_path: "x",
            evidence: "a",
          },
          {
            bucket: "partial",
            spec_item_path: "y",
            evidence: "b",
          },
        ],
        detector_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await persistDrift(mockSb, drifts);

    expect(insertMock).toHaveBeenCalled();
    const insertCall = insertMock.mock.calls[0][0];
    expect(insertCall).toHaveLength(2);
    expect(insertCall[0].spec_item_path).toBe("x");
    expect(insertCall[1].spec_item_path).toBe("y");
  });

  it("handles line_range serialization", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === "daily_reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ developer_id: "dev-1" }],
                  }),
                }),
            }),
          };
        } else if (table === "drift_findings") {
          return { insert: insertMock };
        }
      }),
    } as any;

    const drifts: ParsedDrift[] = [
      {
        kind: "drift",
        repo_id: "repo-1",
        branch: "main",
        commit_sha: "abc",
        date: "2026-05-09",
        findings: [
          {
            bucket: "partial",
            spec_item_path: "x",
            file_path: "src/app.ts",
            line_range: [10, 20],
            evidence: "incomplete",
          },
        ],
        detector_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await persistDrift(mockSb, drifts);

    expect(insertMock).toHaveBeenCalled();
    const insertCall = insertMock.mock.calls[0][0];
    expect(insertCall[0]).toMatchObject({
      file_path: "src/app.ts",
      line_range: "[10,20]",
    });
  });

  it("throws on insert error", async () => {
    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === "daily_reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ developer_id: "dev-1" }],
                  }),
                }),
            }),
          };
        } else if (table === "drift_findings") {
          return {
            insert: vi
              .fn()
              .mockResolvedValue({ error: new Error("Insert failed") }),
          };
        }
      }),
    } as any;

    const drifts: ParsedDrift[] = [
      {
        kind: "drift",
        repo_id: "repo-1",
        branch: "main",
        commit_sha: "abc",
        date: "2026-05-09",
        findings: [
          {
            bucket: "missing",
            spec_item_path: "x",
            evidence: "y",
          },
        ],
        detector_version: "v1+gpt-4o-2024-11-20",
      },
    ];

    await expect(persistDrift(mockSb, drifts)).rejects.toThrow();
  });
});
