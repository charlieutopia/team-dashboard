/// <reference types="node" />
import type OpenAI from "openai";
import type { DailyReport } from "@team-dashboard/shared";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const PROMPT_VERSION = "v1";
export const GENERATOR_VERSION = `${PROMPT_VERSION}+gpt-4o-2024-11-20`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_TEMPLATE = readFileSync(join(__dirname, "prompts", "v1.md"), "utf-8");

export function buildReportPrompt(specText: string, todayDiff: string, yesterdayDiff: string): string {
  return PROMPT_TEMPLATE
    .replaceAll("{{SPEC_TEXT}}", specText)
    .replaceAll("{{TODAY_DIFF}}", todayDiff)
    .replaceAll("{{YESTERDAY_DIFF}}", yesterdayDiff);
}

export const REPORT_FUNCTION_SCHEMA = {
  name: "report_daily",
  description: "Generate a daily team-member report with summary + metrics + spec progress + trajectory",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string" },
      metrics: {
        type: "object",
        properties: {
          commits_today: { type: "number" },
          commits_yesterday: { type: "number" },
          lines_added_today: { type: "number" },
          lines_removed_today: { type: "number" },
          files_touched_today: { type: "array", items: { type: "string" } },
        },
        required: ["commits_today", "commits_yesterday", "lines_added_today", "lines_removed_today", "files_touched_today"],
      },
      spec_progress: {
        type: "object",
        properties: {
          advancing: {
            type: "array",
            items: {
              type: "object",
              properties: {
                spec_item_path: { type: "string" },
                advance_evidence: { type: "string" },
              },
              required: ["spec_item_path", "advance_evidence"],
            },
          },
          drifting: {
            type: "array",
            items: {
              type: "object",
              properties: {
                spec_item_path: { type: "string" },
                drift_evidence: { type: "string" },
              },
              required: ["spec_item_path", "drift_evidence"],
            },
          },
        },
        required: ["advancing", "drifting"],
      },
      trajectory: {
        type: "string",
        enum: ["on_track", "ahead", "behind", "stuck", "no_activity"],
      },
    },
    required: ["summary", "metrics", "spec_progress", "trajectory"],
  },
} as const;

export interface GenerateReportInput {
  developer_handle: string;
  date: string;
  spec_text: string;
  today_diff: string;
  yesterday_diff: string;
}

export async function generateReport(openai: OpenAI, input: GenerateReportInput): Promise<DailyReport> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-2024-11-20",
    messages: [{ role: "user", content: buildReportPrompt(input.spec_text, input.today_diff, input.yesterday_diff) }],
    tools: [{ type: "function", function: REPORT_FUNCTION_SCHEMA }],
    tool_choice: { type: "function", function: { name: "report_daily" } },
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "report_daily") {
    throw new Error("Report generator did not return report_daily tool call");
  }

  const parsed = JSON.parse(toolCall.function.arguments);
  return {
    developer_handle: input.developer_handle,
    date: input.date,
    summary: parsed.summary,
    metrics: parsed.metrics,
    spec_progress: parsed.spec_progress,
    trajectory: parsed.trajectory,
    generator_version: GENERATOR_VERSION,
  };
}

export function buildBatchRequest(input: GenerateReportInput, customId: string) {
  return {
    custom_id: customId,
    method: "POST" as const,
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-2024-11-20",
      messages: [{ role: "user", content: buildReportPrompt(input.spec_text, input.today_diff, input.yesterday_diff) }],
      tools: [{ type: "function", function: REPORT_FUNCTION_SCHEMA }],
      tool_choice: { type: "function", function: { name: "report_daily" } },
    },
  };
}
