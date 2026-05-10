import { spawn } from "node:child_process";
import { z } from "zod";
import type { DailyReport } from "@team-dashboard/shared";

export const GENERATOR_VERSION = "v1+claude-code-headless";
const DEFAULT_TIMEOUT_MS = 180_000; // 3 min — empirical from Phase 2.A Step 7 first run; 60s was too tight for real diff payloads
const STRICT_PREAMBLE =
  "OUTPUT STRICT JSON ONLY. NO MARKDOWN FENCES. NO COMMENTARY. NO PREFACE. JUST THE JSON OBJECT.\n\n";

export interface AnalyzeInput {
  developer_handle: string;
  date: string;
  repo_full_name: string;
  branches: {
    branch_name: string;
    head_sha: string;
    base_sha: string;
    diff_text: string;
  }[];
  spec_text?: string;
}

export interface AnalyzeFailure {
  parse_failed: true;
  error_msg: string;
  developer_handle: string;
  date: string;
}

export type AnalyzeResult = DailyReport | AnalyzeFailure;

export interface AnalyzeOptions {
  timeoutMs?: number;
  claudeBinary?: string;
}

const trajectoryEnum = z.enum([
  "on_track",
  "ahead",
  "behind",
  "stuck",
  "no_activity",
]);

const dailyReportMetricsSchema = z.object({
  commits_today: z.number().int().nonnegative(),
  commits_yesterday: z.number().int().nonnegative(),
  lines_added_today: z.number().int().nonnegative(),
  lines_removed_today: z.number().int().nonnegative(),
  files_touched_today: z.array(z.string()),
});

const dailyReportSpecProgressSchema = z.object({
  advancing: z.array(
    z.object({
      spec_item_path: z.string(),
      advance_evidence: z.string(),
    }),
  ),
  drifting: z.array(
    z.object({
      spec_item_path: z.string(),
      drift_evidence: z.string(),
    }),
  ),
});

export const dailyReportSchema = z.object({
  developer_handle: z.string(),
  date: z.string(),
  summary: z.string(),
  metrics: dailyReportMetricsSchema,
  spec_progress: dailyReportSpecProgressSchema,
  trajectory: trajectoryEnum,
  generator_version: z.string(),
});

export function buildPrompt(input: AnalyzeInput): string {
  const branchBlocks = input.branches
    .map(
      (b) =>
        `### Branch: ${b.branch_name}\nbase_sha: ${b.base_sha}\nhead_sha: ${b.head_sha}\n\n--- DIFF ---\n${b.diff_text}\n--- END DIFF ---`,
    )
    .join("\n\n");

  const specBlock = input.spec_text
    ? `\n--- SPEC ---\n${input.spec_text}\n--- END SPEC ---\n`
    : `\n(no spec module configured)\n`;

  return [
    `You are an analyzer producing a single STRICT JSON DailyReport for one developer's day.`,
    ``,
    `Developer: ${input.developer_handle}`,
    `Date (Asia/Kuala_Lumpur, YYYY-MM-DD): ${input.date}`,
    `Repo: ${input.repo_full_name}`,
    ``,
    `## Cold-context constraint`,
    `Use ONLY the diffs and branch metadata below. Do NOT use commit messages, chat, PR descriptions, or prior reports as evidence — they are biased authoring artefacts. Treat the diff hunks as the only ground truth.`,
    ``,
    `## Branches`,
    branchBlocks || "(no branches)",
    ``,
    `## Spec context`,
    specBlock,
    ``,
    `## Output contract — STRICT JSON, no markdown, no prose`,
    `Return ONE JSON object with EXACTLY these fields:`,
    `{`,
    `  "developer_handle": string,           // pass through "${input.developer_handle}"`,
    `  "date": string,                       // pass through "${input.date}"`,
    `  "summary": string,                    // 150-200 word natural English narrative grounded in diffs`,
    `  "metrics": {`,
    `    "commits_today": integer,`,
    `    "commits_yesterday": integer,`,
    `    "lines_added_today": integer,`,
    `    "lines_removed_today": integer,`,
    `    "files_touched_today": string[]     // file paths from the diff`,
    `  },`,
    `  "spec_progress": {`,
    `    "advancing": [{ "spec_item_path": string, "advance_evidence": string }],`,
    `    "drifting":  [{ "spec_item_path": string, "drift_evidence":  string }]`,
    `  },`,
    `  "trajectory": "on_track" | "ahead" | "behind" | "stuck" | "no_activity",`,
    `  "generator_version": string           // pass through any string; orchestrator overwrites`,
    `}`,
    ``,
    `Field rules:`,
    `- developer_handle, date, generator_version are PASS-THROUGH — echo "${input.developer_handle}" / "${input.date}" / any-string. Orchestrator overwrites generator_version.`,
    `- trajectory MUST be exactly one of the five enum values above.`,
    `- All array fields must be present (use [] when empty). All integer fields must be >= 0.`,
    `- No additional top-level fields. No markdown fences. No commentary.`,
  ].join("\n");
}

interface SpawnAttempt {
  ok: true;
  stdout: string;
}

interface SpawnAttemptFailure {
  ok: false;
  reason: string;
}

type SpawnAttemptResult = SpawnAttempt | SpawnAttemptFailure;

function runOnce(
  binary: string,
  prompt: string,
  timeoutMs: number,
): Promise<SpawnAttemptResult> {
  return new Promise((resolve) => {
    // Pipe prompt via stdin instead of as positional argv entry — argv has a
    // ~256KB OS limit (E2BIG) that real multi-branch diffs exceed in practice.
    // Discovered Phase 2.A Step 7 first run (5 of 16 devs hit E2BIG immediately).
    const child = spawn(binary, ["-p", "--output-format", "json"], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.write(prompt);
    child.stdin?.end();

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: SpawnAttemptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish({ ok: false, reason: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (err: Error) => {
      finish({ ok: false, reason: `spawn error: ${err.message}` });
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        finish({ ok: true, stdout });
      } else if (code === null && settled) {
        // already resolved (timeout)
        return;
      } else {
        const stderrPreview = stderr.slice(0, 200).replace(/\s+/g, " ").trim();
        finish({
          ok: false,
          reason: `spawn exit ${code ?? "null"}: ${stderrPreview || "(no stderr)"}`,
        });
      }
    });
  });
}

interface ParseAttempt {
  ok: true;
  report: DailyReport;
}

interface ParseAttemptFailure {
  ok: false;
  reason: string;
}

type ParseResult = ParseAttempt | ParseAttemptFailure;

// Strip optional ```json ... ``` or ``` ... ``` markdown fences before JSON.parse.
// The model sometimes wraps output in fences despite the prompt instruction;
// rather than rely entirely on retry-with-stricter-prompt, salvage the inner
// payload first. Discovered Phase 2.A Step 7 first run (1 of 16 devs).
export function stripMarkdownFences(s: string): string {
  const m = s.match(/^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  return m && m[1] !== undefined ? m[1].trim() : s.trim();
}

function parseEnvelopeAndValidate(stdout: string): ParseResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch (e) {
    const preview = stdout.slice(0, 40).replace(/\s+/g, " ");
    return {
      ok: false,
      reason: `envelope JSON parse failed: ${(e as Error).message} (preview: ${preview})`,
    };
  }
  const result = (envelope as { result?: unknown })?.result;
  if (typeof result !== "string") {
    return {
      ok: false,
      reason: `envelope missing .result string field`,
    };
  }
  const cleaned = stripMarkdownFences(result);
  let inner: unknown;
  try {
    inner = JSON.parse(cleaned);
  } catch (e) {
    const preview = cleaned.slice(0, 40).replace(/\s+/g, " ");
    return {
      ok: false,
      reason: `JSON parse failed: ${(e as Error).message} (preview: ${preview})`,
    };
  }
  const validation = dailyReportSchema.safeParse(inner);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      reason: `zod validation failed: ${issues}`,
    };
  }
  return { ok: true, report: validation.data };
}

export async function analyzeDevDay(
  input: AnalyzeInput,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binary = options.claudeBinary ?? "claude";
  const basePrompt = buildPrompt(input);

  const failures: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? basePrompt : STRICT_PREAMBLE + basePrompt;
    const spawnResult = await runOnce(binary, prompt, timeoutMs);

    if (!spawnResult.ok) {
      failures.push(spawnResult.reason);
      continue;
    }
    const parsed = parseEnvelopeAndValidate(spawnResult.stdout);
    if (!parsed.ok) {
      failures.push(parsed.reason);
      continue;
    }
    return {
      ...parsed.report,
      developer_handle: input.developer_handle,
      date: input.date,
      generator_version: GENERATOR_VERSION,
    };
  }

  // Build a coherent error message based on what went wrong twice.
  const parseTwice = failures.every((f) => /JSON parse failed/.test(f));
  const timeoutAny = failures.some((f) => /timeout/i.test(f));
  const validationAny = failures.some((f) => /zod validation failed/.test(f));
  const spawnExitAny = failures.some((f) => /spawn exit/.test(f));
  let errorMsg: string;
  if (parseTwice) {
    errorMsg = `JSON parse failed twice: ${failures.join(" | ")}`;
  } else if (failures.every((f) => /timeout/i.test(f))) {
    errorMsg = `timeout on both attempts: ${failures.join(" | ")}`;
  } else {
    const tags = [
      timeoutAny ? "timeout" : null,
      validationAny ? "zod-validation" : null,
      spawnExitAny ? "spawn-exit" : null,
    ]
      .filter(Boolean)
      .join("+");
    errorMsg = `analyze failed twice (${tags || "mixed"}): ${failures.join(" | ")}`;
  }

  return {
    parse_failed: true,
    error_msg: errorMsg,
    developer_handle: input.developer_handle,
    date: input.date,
  };
}
