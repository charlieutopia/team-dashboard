import { spawn } from "node:child_process";
import { z } from "zod";
import type { QualityBand } from "@team-dashboard/shared";
import { firstNameFrom, stripMarkdownFences } from "./analyze.js";

// The AI quality pass. ONE Opus call per developer per ISO week judges the three
// dimensions that need human-like reading to attribute FAIRLY — Code Care,
// Clarity, Stability — and writes the Charlie-facing weekly headline + a
// level-aware needs_a_chat flag. Test Discipline stays deterministic (computed
// from files_touched, not here). Review Citizenship lands in a later slice.
//
// Fairness is the whole game here: these bands go on a real person's card.
// The prompt judges each person from THEIR OWN diffs, reads against their level,
// defaults to the benefit of the doubt when evidence is thin, and never lets
// "fixing other people's bugs" read as instability.
export const GENERATOR_VERSION = "v1+claude-code-headless-quality";
const DEFAULT_TIMEOUT_MS = 240_000;
const RETRY_DIFF_CHAR_BUDGET = 30_000;
const DIFF_TRUNCATION_MARKER = "\n...(diff truncated)";
const STRICT_PREAMBLE =
  "OUTPUT STRICT JSON ONLY. NO MARKDOWN FENCES. NO COMMENTARY. NO PREFACE. JUST THE JSON OBJECT.\n\n";

export interface AnalyzeQualityBranch {
  branch_name: string;
  repo_full_name: string;
  head_sha: string;
  base_sha: string;
  diff_text: string;
  /** Commit subjects on this branch — extra context (e.g. own revert/hotfix
   *  markers). The diffs remain the ground truth. */
  commit_subjects: string[];
}

export interface AnalyzeQualityInput {
  developer_handle: string;
  week_start_date: string; // YYYY-MM-DD Monday KL
  display_name?: string;
  /** intern | junior | senior | freelancer — read the work against THIS bar. */
  level?: string | null;
  branches: AnalyzeQualityBranch[];
}

export interface QualityAiReport {
  developer_handle: string;
  week_start_date: string;
  code_care_band: QualityBand;
  code_care_evidence: string;
  clarity_band: QualityBand;
  clarity_evidence: string;
  stability_band: QualityBand;
  stability_evidence: string;
  headline: string;
  needs_a_chat: boolean;
  generator_version: string;
}

export interface QualityAiFailure {
  parse_failed: true;
  error_msg: string;
  developer_handle: string;
  week_start_date: string;
}

export type AnalyzeQualityResult = QualityAiReport | QualityAiFailure;

export interface AnalyzeQualityOptions {
  timeoutMs?: number;
  claudeBinary?: string;
}

const bandEnum = z.enum(["weak", "developing", "solid", "strong", "skipped"]);

export const qualityReportSchema = z.object({
  developer_handle: z.string(),
  week_start_date: z.string(),
  code_care_band: bandEnum,
  code_care_evidence: z.string(),
  clarity_band: bandEnum,
  clarity_evidence: z.string(),
  stability_band: bandEnum,
  stability_evidence: z.string(),
  headline: z.string(),
  needs_a_chat: z.boolean(),
  generator_version: z.string(),
});

/** A branch counts as "code" only if its diff has real (non-whitespace) content.
 *  Docs/config-only or empty branches don't give us anything to judge. */
function hasCode(branches: AnalyzeQualityBranch[]): boolean {
  return branches.some((b) => (b.diff_text ?? "").trim().length > 0);
}

/** The all-skipped report for a week with no code to judge — returned WITHOUT
 *  spending an Opus call, so inactive developers cost nothing. */
function skippedReport(input: AnalyzeQualityInput): QualityAiReport {
  const why = "Not enough code this week to judge fairly.";
  return {
    developer_handle: input.developer_handle,
    week_start_date: input.week_start_date,
    code_care_band: "skipped",
    code_care_evidence: why,
    clarity_band: "skipped",
    clarity_evidence: why,
    stability_band: "skipped",
    stability_evidence: why,
    headline: `Quiet week for ${firstNameFrom(
      input.display_name,
      input.developer_handle,
    )} — no code to review.`,
    needs_a_chat: false,
    generator_version: GENERATOR_VERSION,
  };
}

/** Cap the combined diff text across branches (newest-first), preserving all
 *  metadata + commit subjects. Mirrors analyze.ts capInputDiffBudget for this
 *  input shape; used on the retry as a smaller-prompt fallback. */
function capDiffBudget(
  input: AnalyzeQualityInput,
  budget: number,
): AnalyzeQualityInput {
  let remaining = budget;
  const branches = input.branches.map((b) => {
    const diff = b.diff_text ?? "";
    if (remaining <= 0) return { ...b, diff_text: "" };
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

export function buildQualityPrompt(input: AnalyzeQualityInput): string {
  const firstName = firstNameFrom(input.display_name, input.developer_handle);
  const level = (input.level ?? "").trim() || "unknown";

  const projectNames = [
    ...new Set(input.branches.map((b) => b.repo_full_name)),
  ].join(", ");

  const branchBlocks = input.branches
    .map((b) => {
      const subjects =
        b.commit_subjects.length > 0
          ? b.commit_subjects.map((s) => `- ${s}`).join("\n")
          : "(none)";
      return `### Branch: ${b.branch_name} (project: ${b.repo_full_name})\nCommit subjects (context only):\n${subjects}\n\n--- DIFF ---\n${b.diff_text}\n--- END DIFF ---`;
    })
    .join("\n\n");

  return [
    `You are a senior engineering coach. You are reviewing ONE developer's week of code so Charlie can support her team.`,
    `This is COACHING, not grading. Charlie manages developers but does NOT read code — you translate what you see into plain language.`,
    ``,
    `## Who you're reviewing`,
    `First name (use in the headline): ${firstName}`,
    `GitHub handle (reference only — never put in the headline): ${input.developer_handle}`,
    `Level: ${level}`,
    `Week starting (Monday, Asia/Kuala_Lumpur, YYYY-MM-DD): ${input.week_start_date}`,
    `Projects: ${projectNames || "(none)"}`,
    ``,
    `## FAIRNESS — read carefully, this goes on a real person's card`,
    `- This is COACHING, never punishment. Default to a generous, supportive read.`,
    `- Be LEVEL-AWARE: read the work against the bar for a ${level}. A junior's "solid" is not a senior's "solid". Never hold a junior to a senior's bar. Be fair.`,
    `- Be CONSERVATIVE: when the evidence is thin or unclear, give the BENEFIT OF THE DOUBT — pick the higher / neutral band, never the low one. Only pick a low band when the diffs CLEARLY show repeated problems.`,
    `- Judge ONLY what is fairly attributable to THIS person's own changes. If a change fixes OTHER people's code or shared problems, that is GOOD citizenship — it must NOT make them look unstable or careless.`,
    `- Every band MUST be backed by a concrete signal you actually saw in the diffs. No band without evidence.`,
    ``,
    `## Ground truth`,
    `Judge from the code changes (diffs) below — they are THIS person's own work this week. Commit subjects are listed for context (they can reveal the person's OWN reverts / urgent fixes), but the diffs are the real evidence.`,
    ``,
    `## Branches (this person's code this week)`,
    branchBlocks || "(no branches)",
    ``,
    `## The three things to judge`,
    `Bands (same five-point scale for all three):`,
    `- "strong" = clearly good for their level`,
    `- "solid" = fine, expected for their level`,
    `- "developing" = some gaps, room to grow (this is NOT a failure)`,
    `- "weak" = clear, repeated problems you can point to in the diffs`,
    `- "skipped" = not enough code to judge fairly`,
    ``,
    `1. **Code Care** — is the work built to last, or likely to need rework soon? Look for: handles errors and edge cases, not copy-pasted, not obviously fragile, sensible structure. Be generous — working code that is a little rough is "solid", not "weak".`,
    `2. **Clarity** — are the changes easy to follow? Look for: focused, right-sized changes (not giant unfocused dumps) and clear commit subjects.`,
    `3. **Stability** — did THIS person's recent work hold up, or did it need urgent fixing? Look for signs in THEIR OWN diffs/commits that they had to undo or urgently re-fix code they just shipped (their own revert, repeated quick fixes to the same area they just changed). If you cannot fairly tell, or the only fixes are to OTHER people's code, choose "strong" or "skipped" — NEVER "weak". Fixing other people's bugs is a GOOD thing.`,
    ``,
    `## Output — STRICT JSON, NO markdown fences, NO commentary`,
    `Return ONE JSON object with EXACTLY these fields:`,
    `{`,
    `  "developer_handle": "${input.developer_handle}",   // PASS THROUGH`,
    `  "week_start_date": "${input.week_start_date}",     // PASS THROUGH`,
    `  "code_care_band": one of the five bands,`,
    `  "code_care_evidence": string,   // ONE short plain sentence, concrete, no code jargon`,
    `  "clarity_band": one of the five bands,`,
    `  "clarity_evidence": string,`,
    `  "stability_band": one of the five bands,`,
    `  "stability_evidence": string,`,
    `  "headline": string,             // see HEADLINE RULES — Charlie reads this`,
    `  "needs_a_chat": boolean,        // true ONLY for a real, specific concern`,
    `  "generator_version": string     // any string — orchestrator overwrites`,
    `}`,
    ``,
    `## HEADLINE RULES (Charlie-facing — ONE sentence)`,
    `- Use the first name ${firstName}. Plain English, supportive, specific: say what went well and (if any) the ONE thing to watch.`,
    `- Banned words inside the headline (rewrite as business outcomes): diff, commit, merge, PR, branch, API, function, variable, schema, migration, SHA, repository, refactor, hotfix, dependency, module, component, endpoint.`,
    `- One sentence. A 12-year-old should understand it.`,
    ``,
    `## EVIDENCE RULES (the three evidence sentences)`,
    `- ONE short plain sentence each. Concrete (say what you saw) but no code jargon.`,
    `- If a band is "skipped", say why in plain words.`,
    ``,
    `## needs_a_chat`,
    `- true ONLY when there is a real, specific, fairly-attributable concern a supportive manager should follow up on this week (read against their level). When unsure → false. Most weeks are false.`,
    ``,
    `## Field rules`,
    `- developer_handle / week_start_date / generator_version: PASS-THROUGH (echo the values above; orchestrator overwrites generator_version).`,
    `- Each band is EXACTLY one of the five strings. No extra top-level fields. No markdown fences anywhere in the output.`,
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
    const child = spawn(
      binary,
      ["-p", "--output-format", "json", "--model", "claude-opus-4-8"],
      { env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] },
    );
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
  report: z.infer<typeof qualityReportSchema>;
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
  const validation = qualityReportSchema.safeParse(inner);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `zod validation failed: ${issues}` };
  }
  return { ok: true, report: validation.data };
}

export async function analyzeDevQuality(
  input: AnalyzeQualityInput,
  options: AnalyzeQualityOptions = {},
): Promise<AnalyzeQualityResult> {
  // No code this week → all-skipped, no Opus call. Inactive devs cost nothing.
  if (!hasCode(input.branches)) {
    return skippedReport(input);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binary = options.claudeBinary ?? "claude";

  const failures: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    // Attempt 0: full input. Attempt 1: strict preamble + halved diff budget.
    const prompt =
      attempt === 0
        ? buildQualityPrompt(input)
        : STRICT_PREAMBLE +
          buildQualityPrompt(capDiffBudget(input, RETRY_DIFF_CHAR_BUDGET));
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
