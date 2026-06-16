import { spawn } from "node:child_process";
import { z } from "zod";
import type { DailyReport } from "@team-dashboard/shared";

export const GENERATOR_VERSION = "v1+claude-code-headless";
// 4 min. Bumped from 180s after a 30-day org-wide backfill: merged
// multi-branch/multi-repo prompts pushed the CLI past the old 3-min ceiling and
// it was killed mid-flight. The upstream run-daily caps now bound the prompt
// size, but the extra headroom keeps a genuinely large (but in-budget) prompt
// from timing out on a slow model day.
const DEFAULT_TIMEOUT_MS = 240_000;
// Second-attempt fallback budget. run-daily already caps the merged diff text,
// but if an over-large prompt still fails the first try we halve the combined
// diff budget for the retry so a smaller prompt gets a chance to land.
const RETRY_DIFF_CHAR_BUDGET = 30_000;
const DIFF_TRUNCATION_MARKER = "\n...(diff truncated)";
const STRICT_PREAMBLE =
  "OUTPUT STRICT JSON ONLY. NO MARKDOWN FENCES. NO COMMENTARY. NO PREFACE. JUST THE JSON OBJECT.\n\n";

export interface AnalyzeInput {
  developer_handle: string;
  date: string;
  branches: {
    branch_name: string;
    head_sha: string;
    base_sha: string;
    diff_text: string;
    // The repo this branch lives in. A developer can have branches across many
    // repos in the org; each branch carries its own repo so the prompt can list
    // every project the person touched in one merged report.
    repo_full_name: string;
  }[];
  spec_text?: string;
  // Optional human display name (e.g. "Naz Najmuddin"). Used to derive a
  // first-name salutation in the Charlie-readable summary. Falls back to the
  // GitHub handle when missing.
  display_name?: string;
}

// First token of display_name, or the github handle as fallback. Charlie-facing
// summaries address each developer by first name only (Range / 15Five tone).
export function firstNameFrom(
  displayName: string | undefined,
  githubHandle: string,
): string {
  const trimmed = (displayName ?? "").trim();
  if (!trimmed) return githubHandle;
  const first = trimmed.split(/\s+/)[0];
  return first && first.length > 0 ? first : githubHandle;
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

// Cap the combined diff-text size across an input's branches, newest-input-order
// first. Used on the retry attempt as a smaller-prompt fallback: walk branches
// in order, spend `budget` chars of diff text, truncate the branch that
// overflows, empty every branch after the budget is spent. Returns a new input
// (does not mutate). Metadata (branch name / shas / repo) is always preserved.
export function capInputDiffBudget(
  input: AnalyzeInput,
  budget: number,
): AnalyzeInput {
  let remaining = budget;
  const branches = input.branches.map((b) => {
    const diff = b.diff_text ?? "";
    if (remaining <= 0) {
      return { ...b, diff_text: "" };
    }
    if (diff.length <= remaining) {
      remaining -= diff.length;
      return b;
    }
    const room = Math.max(0, remaining - DIFF_TRUNCATION_MARKER.length);
    remaining = 0;
    return { ...b, diff_text: diff.slice(0, room) + DIFF_TRUNCATION_MARKER };
  });
  return { ...input, branches };
}

export function buildPrompt(input: AnalyzeInput): string {
  const firstName = firstNameFrom(input.display_name, input.developer_handle);

  const branchBlocks = input.branches
    .map(
      (b) =>
        `### Branch: ${b.branch_name} (project: ${b.repo_full_name})\nbase_sha: ${b.base_sha}\nhead_sha: ${b.head_sha}\n\n--- DIFF ---\n${b.diff_text}\n--- END DIFF ---`,
    )
    .join("\n\n");

  // Distinct project names the person touched this run, across all repos. Keeps
  // the first-seen order so the line reads naturally for Charlie.
  const projectNames = [
    ...new Set(input.branches.map((b) => b.repo_full_name)),
  ].join(", ");

  const specBlock = input.spec_text
    ? `\n--- SPEC ---\n${input.spec_text}\n--- END SPEC ---\n`
    : `\n(no spec module configured)\n`;

  return [
    `You are writing a daily activity note for Charlie to read on her phone.`,
    `She manages developers but does NOT read code. Speak business outcomes, not implementation details.`,
    ``,
    `## Who you're describing`,
    `First name (use this in the summary): ${firstName}`,
    `GitHub handle (for your reference only — DO NOT put this in the summary): ${input.developer_handle}`,
    `Date (Asia/Kuala_Lumpur, YYYY-MM-DD): ${input.date}`,
    `Projects: ${projectNames || "(none)"}`,
    ``,
    `## Ground truth`,
    `Use ONLY the diffs and branch metadata below. IGNORE commit messages, chat, PR descriptions, prior reports — they may be biased authoring artefacts. The code changes are the only ground truth.`,
    ``,
    `## Branches`,
    branchBlocks || "(no branches)",
    ``,
    `## Spec context (what this person is supposed to be working on)`,
    specBlock,
    ``,
    `## Your output — STRICT JSON, NO markdown fences, NO commentary`,
    ``,
    `Return ONE JSON object with EXACTLY these fields:`,
    `{`,
    `  "developer_handle": "${input.developer_handle}",   // PASS THROUGH`,
    `  "date": "${input.date}",                  // PASS THROUGH`,
    `  "summary": string,                        // see SUMMARY RULES below — Charlie reads this`,
    `  "metrics": {`,
    `    "commits_today": integer,               // count of commits attributable to this person today`,
    `    "commits_yesterday": integer,`,
    `    "lines_added_today": integer,`,
    `    "lines_removed_today": integer,`,
    `    "files_touched_today": string[]         // file paths from the changes`,
    `  },`,
    `  "spec_progress": {                        // technical — for Charlie's drill-down audit, NOT the Charlie surface`,
    `    "advancing": [{ "spec_item_path": string, "advance_evidence": string }],`,
    `    "drifting":  [{ "spec_item_path": string, "drift_evidence":  string }]`,
    `  },`,
    `  "trajectory": "on_track" | "ahead" | "behind" | "stuck" | "no_activity",`,
    `  "generator_version": string               // any string — orchestrator overwrites`,
    `}`,
    ``,
    `## SUMMARY RULES (the Charlie-facing field — get this right)`,
    ``,
    `The summary is Charlie's whole window into ${firstName}'s day. She's on her phone. She has 10 seconds.`,
    ``,
    `1. **BLUF — Bottom Line Up Front.** Sentence 1 = the headline: what was the result, or what's the state. Examples:`,
    `   - "${firstName} finished the part that decides which message goes to which staff."`,
    `   - "${firstName} is stuck on the auto-reply rules — the test cases don't match what the spec asks for yet."`,
    `   - "Quiet day for ${firstName} — one small fix to the customer name display."`,
    `2. **First name only.** Use "${firstName}" — never the GitHub handle, never "the developer", never "they/them" as the subject.`,
    `3. **Business language, not code language.** Translate code into business outcomes:`,
    `   - GOOD: "the part that decides which message goes to which staff"`,
    `   - BAD:  "the routing module"`,
    `   - GOOD: "the screen where customers see their order history"`,
    `   - BAD:  "the order-history component"`,
    `4. **Banned words inside the summary string:** diff, commit, rebase, merge, PR, branch, API, function, variable, schema, migration, SHA, repository, refactor, hotfix, dependency, module, component, endpoint. If you reach for one, rewrite as what it does for the business.`,
    `5. **60-100 words. Hard cap 100.** Shorter wins. Cut filler.`,
    `6. **One short paragraph.** No bullet points, no headers, no markdown.`,
    `7. **Tone: like texting an investor about what your team did today.** Plain English, direct, no jargon, no hedging.`,
    `8. **Write in simple, short sentences. One idea per sentence. A 12-year-old should understand it. Avoid long or complex sentences.**`,
    ``,
    `## SUMMARY EXAMPLES (study these — match this tone)`,
    ``,
    `GOOD (active day, on track):`,
    `"${firstName} shipped the new auto-routing today. Incoming customer messages now land with the right staff member based on who handled them last. The work moved fast and matches what the spec asks for. No blockers."`,
    ``,
    `GOOD (stuck day):`,
    `"${firstName} is stuck. Second day trying to make the bulk-import handle Excel files with merged cells, but the test cases keep failing. May need a different approach — what was tried today (a custom parser) added complexity without fixing the core issue."`,
    ``,
    `GOOD (quiet day):`,
    `"Quiet day for ${firstName} — one small fix to how customer names display in the message list. Likely paused on bigger work; nothing in the changes signals a blocker."`,
    ``,
    `BAD (tech-y — DO NOT do this):`,
    `"${firstName} committed 4 changes to the feat/inbox-routing branch, refactoring the router.ts module and updating the API call signatures..."`,
    ``,
    `BAD (no first name — DO NOT do this):`,
    `"The developer worked on the routing module today, with 4 commits..."`,
    ``,
    `## Field rules (other fields)`,
    `- developer_handle / date / generator_version: PASS-THROUGH (echo the values above; orchestrator overwrites generator_version).`,
    `- metrics: count from the diffs; integers >= 0.`,
    `- spec_progress: technical drill-down — file paths and code-level evidence are OK here.`,
    `- trajectory: pick exactly one of the five enums.`,
    `- All array fields present (use [] when empty). No additional top-level fields. No markdown fences anywhere in the output.`,
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
    const child = spawn(binary, ["-p", "--output-format", "json", "--model", "claude-opus-4-8"], {
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

  const failures: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    // Attempt 0: full input. Attempt 1: prepend the strict preamble AND halve
    // the combined diff budget, so an over-large prompt that failed the first
    // try gets a smaller-prompt fallback.
    const prompt =
      attempt === 0
        ? buildPrompt(input)
        : STRICT_PREAMBLE +
          buildPrompt(capInputDiffBudget(input, RETRY_DIFF_CHAR_BUDGET));
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
