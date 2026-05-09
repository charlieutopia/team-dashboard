import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { detectDrift, buildBatchRequest, DETECTOR_VERSION } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const specText = readFileSync(join(fixtureDir, "spec-orders.md"), "utf-8");
const diffText = readFileSync(join(fixtureDir, "diff-orders-on-track.txt"), "utf-8");

describe("detectDrift", () => {
  it("returns DriftReport when OpenAI returns valid tool call", async () => {
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
                        name: "report_findings",
                        arguments: JSON.stringify({
                          findings: [
                            {
                              bucket: "covered",
                              spec_item_path: "spec-orders.md#1-Order-Creation-Endpoint",
                              evidence: "POST /api/orders endpoint implemented with proper validation",
                              file_path: "src/orders.ts",
                              line_range: [22, 28],
                            },
                            {
                              bucket: "partial",
                              spec_item_path: "spec-orders.md#2-Order-Status-State-Machine",
                              evidence: "Status enum defined but state transitions not fully validated",
                              file_path: "src/orders.ts",
                              line_range: [5, 8],
                            },
                          ],
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
    } as unknown as Parameters<typeof detectDrift>[0];

    const result = await detectDrift(mockOpenAI, {
      developer_handle: "alice",
      date: "2026-05-09",
      spec_text: specText,
      diff_text: diffText,
    });

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].bucket).toBe("covered");
    expect(result.findings[1].bucket).toBe("partial");
    expect(result.detector_version).toBe(DETECTOR_VERSION);
    expect(result.developer_handle).toBe("alice");
    expect(result.date).toBe("2026-05-09");
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
    } as unknown as Parameters<typeof detectDrift>[0];

    await expect(
      detectDrift(mockOpenAI, {
        developer_handle: "alice",
        date: "2026-05-09",
        spec_text: specText,
        diff_text: diffText,
      }),
    ).rejects.toThrow("did not return report_findings");
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
    } as unknown as Parameters<typeof detectDrift>[0];

    await expect(
      detectDrift(mockOpenAI, {
        developer_handle: "bob",
        date: "2026-05-09",
        spec_text: specText,
        diff_text: diffText,
      }),
    ).rejects.toThrow("did not return report_findings");
  });
});

describe("buildBatchRequest", () => {
  it("produces a valid OpenAI Batch line with custom_id", () => {
    const req = buildBatchRequest(
      {
        developer_handle: "alice",
        date: "2026-05-09",
        spec_text: specText,
        diff_text: diffText,
      },
      "drift-alice-2026-05-09",
    );

    expect(req.custom_id).toBe("drift-alice-2026-05-09");
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.body.model).toBe("gpt-4o-2024-11-20");
    expect(req.body.messages).toHaveLength(1);
    expect(req.body.messages[0].role).toBe("user");
    expect(req.body.tools).toHaveLength(1);
    expect(req.body.tools[0].type).toBe("function");
    expect(req.body.tools[0].function.name).toBe("report_findings");
    expect(req.body.tool_choice.type).toBe("function");
    expect(req.body.tool_choice.function.name).toBe("report_findings");
  });

  it("includes spec_text and diff_text in the message", () => {
    const req = buildBatchRequest(
      {
        developer_handle: "charlie",
        date: "2026-05-09",
        spec_text: "test spec",
        diff_text: "test diff",
      },
      "drift-charlie-2026-05-09",
    );

    const messageContent = req.body.messages[0].content as string;
    expect(messageContent).toContain("test spec");
    expect(messageContent).toContain("test diff");
  });
});
