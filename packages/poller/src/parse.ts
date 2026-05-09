import type { DailyReport, DriftFinding } from "@team-dashboard/shared";

export interface ParsedReport {
  kind: "report";
  repo_id: string;
  developer_id: string;
  date: string;
  raw_summary: string;
  raw_metrics: any;
  raw_spec_progress: any;
  raw_trajectory: string;
  generator_version: string;
}

export interface ParsedDrift {
  kind: "drift";
  repo_id: string;
  branch: string;
  commit_sha: string;
  date: string;
  findings: DriftFinding[];
  detector_version: string;
}

export type ParsedItem = ParsedReport | ParsedDrift;

export function parseBatchOutput(jsonlText: string): ParsedItem[] {
  const lines = jsonlText.trim().split("\n").filter(l => l.trim().length > 0);
  const results: ParsedItem[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const customId: string = obj.custom_id;
      const toolCallArgs = obj.response?.body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!toolCallArgs) {
        console.warn(`No tool call in batch output for custom_id ${customId} — skipping`);
        continue;
      }
      const parsedArgs = typeof toolCallArgs === "string" ? JSON.parse(toolCallArgs) : toolCallArgs;

      const parts = customId.split("|");
      if (parts[0] === "drift") {
        const repo_id = parts[1];
        const branch = parts[2];
        const commit_sha = parts[3];
        const date = parts[4];
        if (repo_id && branch && commit_sha && date) {
          results.push({
            kind: "drift",
            repo_id,
            branch,
            commit_sha,
            date,
            findings: parsedArgs.findings ?? [],
            detector_version: "v1+gpt-4o-2024-11-20",
          });
        }
      } else if (parts[0] === "report") {
        const repo_id = parts[1];
        const developer_id = parts[2];
        const date = parts[3];
        if (repo_id && developer_id && date) {
          results.push({
            kind: "report",
            repo_id,
            developer_id,
            date,
            raw_summary: parsedArgs.summary,
            raw_metrics: parsedArgs.metrics,
            raw_spec_progress: parsedArgs.spec_progress,
            raw_trajectory: parsedArgs.trajectory,
            generator_version: "v1+gpt-4o-2024-11-20",
          });
        }
      } else {
        console.warn(`Unknown custom_id prefix: ${parts[0]} — skipping`);
      }
    } catch (err) {
      console.warn(`Failed to parse batch output line: ${err}`);
    }
  }

  return results;
}
