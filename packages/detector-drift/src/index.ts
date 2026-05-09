import type OpenAI from "openai";
import type { DriftReport, DriftFinding } from "@team-dashboard/shared";
import { PROMPT_VERSION, buildDriftPrompt, DRIFT_FUNCTION_SCHEMA } from "./prompt.js";

export const DETECTOR_VERSION = `${PROMPT_VERSION}+gpt-4o-2024-11-20`;

export interface DetectDriftInput {
  developer_handle: string;
  date: string;
  spec_text: string;
  diff_text: string;
}

export async function detectDrift(
  openai: OpenAI,
  input: DetectDriftInput,
): Promise<DriftReport> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-2024-11-20",
    messages: [{ role: "user", content: buildDriftPrompt(input.spec_text, input.diff_text) }],
    tools: [{ type: "function", function: DRIFT_FUNCTION_SCHEMA }],
    tool_choice: { type: "function", function: { name: "report_findings" } },
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "report_findings") {
    throw new Error("Drift detector did not return report_findings tool call");
  }

  const parsed = JSON.parse(toolCall.function.arguments) as { findings: DriftFinding[] };
  return {
    developer_handle: input.developer_handle,
    date: input.date,
    findings: parsed.findings,
    detector_version: DETECTOR_VERSION,
  };
}

export function buildBatchRequest(input: DetectDriftInput, customId: string) {
  return {
    custom_id: customId,
    method: "POST" as const,
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-2024-11-20",
      messages: [{ role: "user", content: buildDriftPrompt(input.spec_text, input.diff_text) }],
      tools: [{ type: "function", function: DRIFT_FUNCTION_SCHEMA }],
      tool_choice: { type: "function", function: { name: "report_findings" } },
    },
  };
}
