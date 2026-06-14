import { spawn } from "node:child_process";
import { z } from "zod";
import type {
  MonthlyReport,
  Trajectory,
  DailyReportMetrics,
  Momentum,
} from "@team-dashboard/shared";
import { firstNameFrom, stripMarkdownFences } from "./analyze.js";

export const GENERATOR_VERSION = "v1+claude-code-headless-monthly";
const DEFAULT_TIMEOUT_MS = 240_000; // 4 min — a month of input is the largest aggregation, give the model more time
const STRICT_PREAMBLE =
  "OUTPUT STRICT JSON ONLY. NO MARKDOWN FENCES. NO COMMENTARY. NO PREFACE. JUST THE JSON OBJECT.\n\n";

export interface AnalyzeMonthlyDay {
  report_date: string;
  summary: string | null;
  trajectory: Trajectory | null;
  metrics: DailyReportMetrics | null;
  parse_failed: boolean;
}

export interface AnalyzeMonthlyWeek {
  week_start_date: string;
  summary: string | null;
  momentum: Momentum | null;
  top_themes: string[] | null;
}

export interface AnalyzeMonthlyInput {
  developer_handle: string;
  month_start_date: string; // YYYY-MM-DD first-of-month KL
  display_name?: string;
  days: AnalyzeMonthlyDay[];
  weeks: AnalyzeMonthlyWeek[];
  total_working_days_in_month: number;
  total_on_leave_days_in_month: number;
}

export interface AnalyzeMonthlyFailure {
  parse_failed: true;
  error_msg: string;
  developer_handle: string;
  month_start_date: string;
}

export type AnalyzeMonthlyResult = MonthlyReport | AnalyzeMonthlyFailure;

export interface AnalyzeMonthlyOptions {
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

export const monthlyReportSchema = z.object({
  developer_handle: z.string(),
  month_start_date: z.string(),
  summary: z.string(),
  momentum: momentumEnum,
  top_themes: z.array(z.string()),
  generator_version: z.string(),
});

export function buildMonthlyPrompt(input: AnalyzeMonthlyInput): string {
  const firstName = firstNameFrom(input.display_name, input.developer_handle);

  const dayBlocks = input.days
    .map((d) => {
      const t = d.trajectory ?? "no_data";
      const m = d.metrics;
      const metricsLine = m
        ? `commits=${m.commits_today} added=${m.lines_added_today} removed=${m.lines_removed_today}`
        : "no metrics";
      const summaryLine = d.parse_failed
        ? "(daily analysis failed)"
        : (d.summary ?? "(no summary)");
      return `${d.report_date} [${t}] ${metricsLine}\n  ${summaryLine}`;
    })
    .join("\n");

  const weekBlocks = input.weeks
    .map((w) => {
      const themes =
        w.top_themes && w.top_themes.length > 0
          ? ` themes=[${w.top_themes.join(", ")}]`
          : "";
      return `Week of ${w.week_start_date} [momentum=${w.momentum ?? "unknown"}]${themes}\n  ${w.summary ?? "(no weekly summary)"}`;
    })
    .join("\n\n");

  return [
    `You are writing a MONTHLY activity note for Charlie to read on her phone on the first of the month.`,
    `She manages developers but does NOT read code. Speak business outcomes for the whole month, not implementation details.`,
    ``,
    `## Who you're describing`,
    `First name (use this in the summary): ${firstName}`,
    `GitHub handle (for your reference only — DO NOT put this in the summary): ${input.developer_handle}`,
    `Month starting (Asia/Kuala_Lumpur, YYYY-MM-DD): ${input.month_start_date}`,
    ``,
    `## Ground truth`,
    `Use ONLY the daily summaries + weekly digests below as input. Each daily summary was written from real code changes (no commit messages, no chat — just diffs). Each weekly digest was written from those daily summaries. You are now zooming out one more level: aggregating the weekly digests into a one-month trend narrative. Do NOT invent activity not present in the inputs.`,
    ``,
    `## Month totals`,
    `working_days_in_month: ${input.total_working_days_in_month} (after weekends, public holidays, approved leave)`,
    `total_on_leave_days_in_month: ${input.total_on_leave_days_in_month}`,
    `days_with_daily_report: ${input.days.length}`,
    ``,
    `## Weekly digests (the primary input — most important)`,
    weekBlocks || "(no weekly digests for this month)",
    ``,
    `## Daily summaries (secondary detail — use for standout moments)`,
    dayBlocks || "(no daily reports for this month)",
    ``,
    `## Your output — STRICT JSON, NO markdown fences, NO commentary`,
    ``,
    `Return ONE JSON object with EXACTLY these fields:`,
    `{`,
    `  "developer_handle": "${input.developer_handle}",   // PASS THROUGH`,
    `  "month_start_date": "${input.month_start_date}",   // PASS THROUGH`,
    `  "summary": string,                       // see SUMMARY RULES below — Charlie reads this`,
    `  "momentum": "accelerating" | "steady" | "slowing" | "stalled" | "no_activity",`,
    `  "top_themes": string[],                  // 3-5 short business-language tags`,
    `  "generator_version": string              // any string — orchestrator overwrites`,
    `}`,
    ``,
    `## SUMMARY RULES (the Charlie-facing field — get this right)`,
    ``,
    `The summary is Charlie's whole window into ${firstName}'s month. She reads on her phone first thing on the 1st. She has 30 seconds.`,
    ``,
    `1. **BLUF — Bottom Line Up Front.** Sentence 1 = the month's headline: was this a strong month, a quiet month, a stuck month, or a mixed month? Examples:`,
    `   - "${firstName} had a strong month — the customer messaging flow shipped and the team picked up speed in the second half."`,
    `   - "${firstName} is stuck. Three weeks running on the bulk-import work without a clear breakthrough."`,
    `   - "Quiet month for ${firstName} — light activity overall, mostly small fixes."`,
    `   - "Mixed month for ${firstName}: strong first two weeks shipping the new dashboard, then quiet for the rest."`,
    `2. **First name only.** Use "${firstName}" — never the GitHub handle, never "the developer".`,
    `3. **Business language, not code language.** Translate code into business outcomes:`,
    `   - GOOD: "the screen where customers see their order history"`,
    `   - BAD:  "the order-history page component"`,
    `4. **Banned words inside the summary:** diff, commit, rebase, merge, PR, branch, API, function, variable, schema, migration, SHA, repository, refactor, hotfix, dependency, module, component, endpoint.`,
    `5. **180-280 words. Hard cap 280.** A month deserves a richer narrative than a week, but Charlie is still on her phone.`,
    `6. **Tell a TREND STORY, not a chronological list.** Don't write "in week 1 they did X, in week 2 Y, in week 3 Z". Instead: "${firstName} spent the month on two themes — A in the first half, B in the second. The pace picked up around mid-month." Trend > timeline.`,
    `7. **One or two paragraphs.** Two paragraphs is fine when the month genuinely splits into two themes; otherwise one is better. No bullets, no headers.`,
    `8. **Tone target: a quarterly business review note**, but for one person, for one month. Plain English, direct, no jargon, no hedging.`,
    ``,
    `## TOP THEMES RULES`,
    ``,
    `top_themes is 3-5 short tags, each 2-6 words, in business language. Themes should describe AREAS OF FOCUS, not weeks or sprints:`,
    `- GOOD: "customer messaging flow", "manager approval rebuild", "operations tooling", "performance fixes"`,
    `- BAD:  "Week 1 work", "router.ts refactor", "v2.3 release"`,
    `- If the month was genuinely thin (1-2 small fixes), use 1-2 themes — don't pad.`,
    ``,
    `## MOMENTUM RULES`,
    ``,
    `Pick exactly ONE based on the trend across the four weeks of the month:`,
    `- "accelerating" — output picked up in the second half. Several "ahead" weeks. Big wins late.`,
    `- "steady" — flat across the month. Most weeks similar. Reliable.`,
    `- "slowing" — output dropped in the second half. More "behind" / "stuck" weeks late.`,
    `- "stalled" — multiple weeks with little or no progress. Real blocker present.`,
    `- "no_activity" — almost no work across the whole month.`,
    ``,
    `## Field rules`,
    `- developer_handle / month_start_date / generator_version: PASS-THROUGH (echo the values above; orchestrator overwrites generator_version).`,
    `- All array fields present (use [] when empty). No additional top-level fields. No markdown fences anywhere.`,
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
  report: MonthlyReport;
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
  const validation = monthlyReportSchema.safeParse(inner);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `zod validation failed: ${issues}` };
  }
  return { ok: true, report: validation.data };
}

export async function analyzeDevMonth(
  input: AnalyzeMonthlyInput,
  options: AnalyzeMonthlyOptions = {},
): Promise<AnalyzeMonthlyResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binary = options.claudeBinary ?? "claude";
  const basePrompt = buildMonthlyPrompt(input);

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
      month_start_date: input.month_start_date,
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
    month_start_date: input.month_start_date,
  };
}
