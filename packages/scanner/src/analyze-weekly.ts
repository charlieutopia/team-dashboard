import { spawn } from "node:child_process";
import { z } from "zod";
import type {
  WeeklyReport,
  Trajectory,
  DailyReportMetrics,
} from "@team-dashboard/shared";
import { firstNameFrom, stripMarkdownFences } from "./analyze.js";

export const GENERATOR_VERSION = "v1+claude-code-headless-weekly";
const DEFAULT_TIMEOUT_MS = 180_000;
const STRICT_PREAMBLE =
  "OUTPUT STRICT JSON ONLY. NO MARKDOWN FENCES. NO COMMENTARY. NO PREFACE. JUST THE JSON OBJECT.\n\n";

export interface AnalyzeWeeklyDay {
  report_date: string;
  summary: string | null;
  trajectory: Trajectory | null;
  metrics: DailyReportMetrics | null;
  parse_failed: boolean;
}

export interface AnalyzeWeeklyInput {
  developer_handle: string;
  week_start_date: string; // YYYY-MM-DD Monday KL
  display_name?: string;
  days: AnalyzeWeeklyDay[];
}

export interface AnalyzeWeeklyFailure {
  parse_failed: true;
  error_msg: string;
  developer_handle: string;
  week_start_date: string;
}

export type AnalyzeWeeklyResult = WeeklyReport | AnalyzeWeeklyFailure;

export interface AnalyzeWeeklyOptions {
  timeoutMs?: number;
  claudeBinary?: string;
}

const momentumEnum = z.enum([
  "accelerating",
  "steady",
  "slowing",
  "stalled",
  "no_activity",
]);

export const weeklyReportSchema = z.object({
  developer_handle: z.string(),
  week_start_date: z.string(),
  summary: z.string(),
  momentum: momentumEnum,
  top_themes: z.array(z.string()),
  generator_version: z.string(),
});

function metricsTotals(days: AnalyzeWeeklyDay[]): {
  commits: number;
  added: number;
  removed: number;
  files: number;
  active_days: number;
} {
  let commits = 0;
  let added = 0;
  let removed = 0;
  const fileSet = new Set<string>();
  let active = 0;
  for (const d of days) {
    const m = d.metrics;
    if (!m) continue;
    if (m.commits_today > 0) active += 1;
    commits += m.commits_today;
    added += m.lines_added_today;
    removed += m.lines_removed_today;
    for (const f of m.files_touched_today ?? []) fileSet.add(f);
  }
  return {
    commits,
    added,
    removed,
    files: fileSet.size,
    active_days: active,
  };
}

export function buildWeeklyPrompt(input: AnalyzeWeeklyInput): string {
  const firstName = firstNameFrom(input.display_name, input.developer_handle);
  const totals = metricsTotals(input.days);

  const dayBlocks = input.days
    .map((d) => {
      const t = d.trajectory ?? "no_data";
      const m = d.metrics;
      const metricsLine = m
        ? `commits=${m.commits_today} added=${m.lines_added_today} removed=${m.lines_removed_today} files=${m.files_touched_today.length}`
        : "no metrics";
      const summaryLine = d.parse_failed
        ? "(daily analysis failed for this day — no summary)"
        : (d.summary ?? "(no summary)");
      return `### ${d.report_date} — trajectory=${t} | ${metricsLine}\n${summaryLine}`;
    })
    .join("\n\n");

  return [
    `You are writing a WEEKLY activity note for the Boss to read on her phone Monday morning.`,
    `She manages developers but does NOT read code. Speak business outcomes for the whole week, not implementation details.`,
    ``,
    `## Who you're describing`,
    `First name (use this in the summary): ${firstName}`,
    `GitHub handle (for your reference only — DO NOT put this in the summary): ${input.developer_handle}`,
    `Week starting (Monday, Asia/Kuala_Lumpur, YYYY-MM-DD): ${input.week_start_date}`,
    ``,
    `## Ground truth`,
    `Use ONLY the daily summaries + per-day trajectory + per-day metrics below as input. Each day's summary was already written by an analyzer that read the actual code changes (with no commit messages, no chat, no PR descriptions — pure code diffs). You are aggregating those daily readings into a one-week narrative. Do NOT invent activity not present in the daily summaries.`,
    ``,
    `## Week totals (computed from per-day metrics)`,
    `active_days_with_commits: ${totals.active_days}/${input.days.length}`,
    `total_commits: ${totals.commits}`,
    `total_lines_added: ${totals.added}`,
    `total_lines_removed: ${totals.removed}`,
    `unique_files_touched: ${totals.files}`,
    ``,
    `## Daily inputs (in date order)`,
    dayBlocks || "(no days in this week)",
    ``,
    `## Your output — STRICT JSON, NO markdown fences, NO commentary`,
    ``,
    `Return ONE JSON object with EXACTLY these fields:`,
    `{`,
    `  "developer_handle": "${input.developer_handle}",   // PASS THROUGH`,
    `  "week_start_date": "${input.week_start_date}",     // PASS THROUGH`,
    `  "summary": string,                          // see SUMMARY RULES below — Boss reads this`,
    `  "momentum": "accelerating" | "steady" | "slowing" | "stalled" | "no_activity",`,
    `  "top_themes": string[],                     // 3-5 short business-language tags (NOT code paths)`,
    `  "generator_version": string                 // any string — orchestrator overwrites`,
    `}`,
    ``,
    `## SUMMARY RULES (the Boss-facing field — get this right)`,
    ``,
    `The summary is the Boss's whole window into ${firstName}'s week. She reads on Monday morning. She has 15 seconds.`,
    ``,
    `1. **BLUF — Bottom Line Up Front.** Sentence 1 = the headline of the week: what was achieved, what's the state, or what stalled. Examples:`,
    `   - "${firstName} had a strong week — the cost-recovery flow is now live and accounts staff can use it."`,
    `   - "${firstName} is stuck on the bulk-import work — second week in a row without breaking through."`,
    `   - "Quiet week for ${firstName} — light activity, mostly small fixes."`,
    `2. **First name only.** Use "${firstName}" — never the GitHub handle, never "the developer", never "they/them" as the lead subject.`,
    `3. **Business language, not code language.** Translate code into business outcomes:`,
    `   - GOOD: "the part that decides which message goes to which staff"`,
    `   - BAD:  "the routing module"`,
    `4. **Banned words inside the summary string:** diff, commit, rebase, merge, PR, branch, API, function, variable, schema, migration, SHA, repository, refactor, hotfix, dependency, module, component, endpoint. If you reach for one, rewrite as what it does for the business.`,
    `5. **100-180 words. Hard cap 180.** A week deserves more space than a day, but Boss is still on her phone — keep it tight.`,
    `6. **One short paragraph (or two if the week splits cleanly into two themes).** No bullet points, no headers, no markdown.`,
    `7. **Tone: like texting an investor about what your team did this week.** Plain English, direct, no jargon, no hedging.`,
    ``,
    `## TOP THEMES RULES`,
    ``,
    `top_themes is 3-5 short tags, EACH 2-6 words, in business language:`,
    `- GOOD: "cost-recovery flow rebuild", "platform feature toggles", "operations tooling"`,
    `- BAD:  "router.ts refactor", "Postgres migration 00012", "API v2 endpoints"`,
    `- If the week is genuinely thin (1-2 small fixes), use 1-2 themes — don't pad.`,
    ``,
    `## MOMENTUM RULES`,
    ``,
    `Pick exactly ONE based on this week's volume + outcomes vs. the daily summaries' tone:`,
    `- "accelerating" — clearly more output / more impact than recent baseline. Many "ahead" trajectories. Big shipped wins.`,
    `- "steady" — typical week. Mix of "on_track" days. Work flowing as expected.`,
    `- "slowing" — output noticeably down. More "behind" than usual. Velocity dropping.`,
    `- "stalled" — almost no progress. Multiple "stuck" or "no_activity" days. Real blocker present.`,
    `- "no_activity" — zero or near-zero activity across the whole week.`,
    ``,
    `## Field rules`,
    `- developer_handle / week_start_date / generator_version: PASS-THROUGH (echo the values above; orchestrator overwrites generator_version).`,
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
  report: WeeklyReport;
}

interface ParseAttemptFailure {
  ok: false;
  reason: string;
}

type ParseResult = ParseAttempt | ParseAttemptFailure;

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
    return { ok: false, reason: `envelope missing .result string field` };
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
  const validation = weeklyReportSchema.safeParse(inner);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `zod validation failed: ${issues}` };
  }
  return { ok: true, report: validation.data };
}

export async function analyzeDevWeek(
  input: AnalyzeWeeklyInput,
  options: AnalyzeWeeklyOptions = {},
): Promise<AnalyzeWeeklyResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binary = options.claudeBinary ?? "claude";
  const basePrompt = buildWeeklyPrompt(input);

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
      week_start_date: input.week_start_date,
      generator_version: GENERATOR_VERSION,
    };
  }

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
    week_start_date: input.week_start_date,
  };
}
