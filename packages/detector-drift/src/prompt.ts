export const PROMPT_VERSION = "v1";

export function buildDriftPrompt(specText: string, diffText: string): string {
  return `You are a strict spec-to-code conformance checker. You have ZERO context about who wrote this code or why. You receive only the spec and the diff.

For every spec item in the spec, classify into ONE of:
- covered: implementation in the diff matches the spec item
- partial: implementation exists but is incomplete vs spec
- out_of_scope: code in diff does NOT map to any spec item (drift)
- missing: spec item exists but no diff coverage

Every finding MUST cite spec line range and diff line range. Findings without grounding are rejected.

SPEC:
\`\`\`
${specText}
\`\`\`

DIFF:
\`\`\`
${diffText}
\`\`\`

Return findings via the report_findings function call.`;
}

export const DRIFT_FUNCTION_SCHEMA = {
  name: "report_findings",
  description: "Report spec drift findings with grounded line citations",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bucket: { type: "string", enum: ["covered", "partial", "out_of_scope", "missing"] },
            spec_item_path: { type: "string" },
            file_path: { type: "string" },
            line_range: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            evidence: { type: "string" },
          },
          required: ["bucket", "spec_item_path", "evidence"],
        },
      },
    },
    required: ["findings"],
  },
} as const;
