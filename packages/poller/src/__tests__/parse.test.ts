import { describe, it, expect } from "vitest";
import { parseBatchOutput } from "../parse";

describe("parseBatchOutput", () => {
  it("parses drift custom_id correctly", () => {
    const jsonlInput = JSON.stringify({
      custom_id: "drift|repo-123|main|abc123def|2026-05-09",
      response: {
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        findings: [
                          {
                            bucket: "missing",
                            spec_item_path: "services/api",
                            evidence: "No test coverage",
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("drift");
    expect(results[0]).toMatchObject({
      repo_id: "repo-123",
      branch: "main",
      commit_sha: "abc123def",
      date: "2026-05-09",
    });
    expect(results[0].findings).toHaveLength(1);
    expect(results[0].findings[0].bucket).toBe("missing");
  });

  it("parses report custom_id correctly", () => {
    const jsonlInput = JSON.stringify({
      custom_id: "report|repo-123|dev-456|2026-05-09",
      response: {
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        summary: "Good progress",
                        metrics: { commits_today: 3 },
                        spec_progress: { advancing: [], drifting: [] },
                        trajectory: "on_track",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("report");
    expect(results[0]).toMatchObject({
      repo_id: "repo-123",
      developer_id: "dev-456",
      date: "2026-05-09",
    });
    expect(results[0].raw_summary).toBe("Good progress");
  });

  it("skips lines without tool calls", () => {
    const jsonlInput =
      JSON.stringify({
        custom_id: "report|repo-123|dev-456|2026-05-09",
        response: { body: { choices: [] } },
      }) +
      "\n" +
      JSON.stringify({
        custom_id: "drift|repo-123|main|abc|2026-05-09",
        response: {
          body: {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          findings: [
                            { bucket: "missing", spec_item_path: "x", evidence: "y" },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("drift");
  });

  it("handles multiple findings in a drift", () => {
    const jsonlInput = JSON.stringify({
      custom_id: "drift|repo-123|main|abc|2026-05-09",
      response: {
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        findings: [
                          {
                            bucket: "missing",
                            spec_item_path: "services/api",
                            evidence: "No tests",
                          },
                          {
                            bucket: "partial",
                            spec_item_path: "services/db",
                            evidence: "Incomplete",
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].findings).toHaveLength(2);
  });

  it("ignores unknown custom_id prefixes", () => {
    const jsonlInput =
      JSON.stringify({
        custom_id: "unknown|repo-123|data",
        response: {
          body: {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({ data: "x" }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      }) +
      "\n" +
      JSON.stringify({
        custom_id: "report|repo-123|dev-456|2026-05-09",
        response: {
          body: {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          summary: "Ok",
                          metrics: {},
                          spec_progress: { advancing: [], drifting: [] },
                          trajectory: "on_track",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("report");
  });

  it("returns empty array for empty jsonl", () => {
    const results = parseBatchOutput("");
    expect(results).toEqual([]);
  });

  it("parses when tool_calls arguments is already an object", () => {
    const jsonlInput = JSON.stringify({
      custom_id: "report|repo-123|dev-456|2026-05-09",
      response: {
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: {
                        summary: "Good",
                        metrics: {},
                        spec_progress: { advancing: [], drifting: [] },
                        trajectory: "on_track",
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const results = parseBatchOutput(jsonlInput);
    expect(results).toHaveLength(1);
    expect(results[0].raw_summary).toBe("Good");
  });
});
