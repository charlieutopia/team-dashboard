import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateReport, buildBatchRequest, buildReportPrompt, GENERATOR_VERSION } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const specText = readFileSync(join(fixtureDir, "spec-orders.md"), "utf-8");
const diffYesterday = readFileSync(join(fixtureDir, "diff-yesterday.txt"), "utf-8");
const diffToday = readFileSync(join(fixtureDir, "diff-today.txt"), "utf-8");

describe("generateReport", () => {
  it("returns valid DailyReport shape when OpenAI returns valid tool call", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "report_daily",
                        arguments: JSON.stringify({
                          summary:
                            "Strong progress today. Completed Cart-to-Order Conversion (spec section 3) with full idempotency support and inventory reservation logic. Yesterday built the foundational Order Creation Endpoint and LineItem structures; today added the conversion flow with 47 lines of new implementation code. Testing inventory handling and edge cases pending. On track to complete Order Status State Machine by end of week.",
                          metrics: {
                            commits_today: 2,
                            commits_yesterday: 1,
                            lines_added_today: 47,
                            lines_removed_today: 3,
                            files_touched_today: ["src/orders.ts"],
                          },
                          spec_progress: {
                            advancing: [
                              {
                                spec_item_path: "spec-orders.md#3-Cart-to-Order-Conversion",
                                advance_evidence: "Implemented full conversion flow with inventory reservation and idempotency via Idempotency-Key header",
                              },
                            ],
                            drifting: [],
                          },
                          trajectory: "on_track",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    } as unknown as Parameters<typeof generateReport>[0];

    const result = await generateReport(mockOpenAI, {
      developer_handle: "alice",
      date: "2026-05-09",
      spec_text: specText,
      today_diff: diffToday,
      yesterday_diff: diffYesterday,
    });

    // Verify DailyReport shape
    expect(result.developer_handle).toBe("alice");
    expect(result.date).toBe("2026-05-09");
    expect(result.summary).toBeTruthy();
    expect(result.summary.length).toBeGreaterThanOrEqual(100);
    expect(result.summary.length).toBeLessThanOrEqual(1500);
    expect(["on_track", "ahead", "behind", "stuck", "no_activity"]).toContain(result.trajectory);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.commits_today).toBeDefined();
    expect(result.metrics.commits_yesterday).toBeDefined();
    expect(result.metrics.lines_added_today).toBeDefined();
    expect(result.metrics.lines_removed_today).toBeDefined();
    expect(Array.isArray(result.metrics.files_touched_today)).toBe(true);
    expect(result.spec_progress).toBeDefined();
    expect(Array.isArray(result.spec_progress.advancing)).toBe(true);
    expect(Array.isArray(result.spec_progress.drifting)).toBe(true);
    expect(result.generator_version).toBe(GENERATOR_VERSION);
  });

  it("throws when no tool call returned", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: {} }],
          }),
        },
      },
    } as unknown as Parameters<typeof generateReport>[0];

    await expect(
      generateReport(mockOpenAI, {
        developer_handle: "alice",
        date: "2026-05-09",
        spec_text: specText,
        today_diff: diffToday,
        yesterday_diff: diffYesterday,
      }),
    ).rejects.toThrow("did not return report_daily");
  });

  it("throws when tool call function name is incorrect", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "wrong_function",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    } as unknown as Parameters<typeof generateReport>[0];

    await expect(
      generateReport(mockOpenAI, {
        developer_handle: "bob",
        date: "2026-05-09",
        spec_text: specText,
        today_diff: diffToday,
        yesterday_diff: diffYesterday,
      }),
    ).rejects.toThrow("did not return report_daily");
  });
});

describe("buildBatchRequest", () => {
  it("produces a valid OpenAI Batch line with custom_id", () => {
    const req = buildBatchRequest(
      {
        developer_handle: "alice",
        date: "2026-05-09",
        spec_text: specText,
        today_diff: diffToday,
        yesterday_diff: diffYesterday,
      },
      "report-alice-2026-05-09",
    );

    expect(req.custom_id).toBe("report-alice-2026-05-09");
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.body.model).toBe("gpt-4o-2024-11-20");
    expect(req.body.messages).toHaveLength(1);
    expect(req.body.messages[0].role).toBe("user");
    expect(req.body.tools).toHaveLength(1);
    expect(req.body.tools[0].type).toBe("function");
    expect(req.body.tools[0].function.name).toBe("report_daily");
    expect(req.body.tool_choice.type).toBe("function");
    expect(req.body.tool_choice.function.name).toBe("report_daily");
  });

  it("includes spec_text, today_diff, and yesterday_diff in the message", () => {
    const req = buildBatchRequest(
      {
        developer_handle: "charlie",
        date: "2026-05-09",
        spec_text: "test spec",
        today_diff: "test today diff",
        yesterday_diff: "test yesterday diff",
      },
      "report-charlie-2026-05-09",
    );

    const messageContent = req.body.messages[0].content as string;
    expect(messageContent).toContain("test spec");
    expect(messageContent).toContain("test today diff");
    expect(messageContent).toContain("test yesterday diff");
  });
});

describe("buildReportPrompt", () => {
  it("correctly substitutes template placeholders", () => {
    const prompt = buildReportPrompt("SPEC_CONTENT", "TODAY_CONTENT", "YESTERDAY_CONTENT");

    expect(prompt).toContain("SPEC_CONTENT");
    expect(prompt).toContain("TODAY_CONTENT");
    expect(prompt).toContain("YESTERDAY_CONTENT");
    expect(prompt).not.toContain("{{SPEC_TEXT}}");
    expect(prompt).not.toContain("{{TODAY_DIFF}}");
    expect(prompt).not.toContain("{{YESTERDAY_DIFF}}");
  });

  it("produces the same output for the same inputs", () => {
    const prompt1 = buildReportPrompt(specText, diffToday, diffYesterday);
    const prompt2 = buildReportPrompt(specText, diffToday, diffYesterday);

    expect(prompt1).toBe(prompt2);
  });
});
