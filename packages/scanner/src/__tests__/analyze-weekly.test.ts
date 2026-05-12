import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { WeeklyReport } from "@team-dashboard/shared";

// vi.mock factories are hoisted; keep state external so tests can swap behavior.
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER mocks are registered.
const { analyzeDevWeek, buildWeeklyPrompt } = await import(
  "../analyze-weekly.js"
);
type AnalyzeWeeklyInput = Parameters<typeof analyzeDevWeek>[0];

interface FakeChildOptions {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  hang?: boolean;
  emitDelayMs?: number;
}

class FakeStdin {
  written = "";
  ended = false;
  write(chunk: string | Buffer): boolean {
    this.written += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    return true;
  }
  end(): void {
    this.ended = true;
  }
}

class FakeChild extends EventEmitter {
  stdin = new FakeStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  pid = 12345;
  killSignal: string | undefined;

  constructor(opts: FakeChildOptions) {
    super();
    if (opts.hang) return;
    const delay = opts.emitDelayMs ?? 0;
    setTimeout(() => {
      for (const chunk of opts.stdoutChunks ?? []) {
        this.stdout.emit("data", Buffer.from(chunk));
      }
      for (const chunk of opts.stderrChunks ?? []) {
        this.stderr.emit("data", Buffer.from(chunk));
      }
      this.stdout.emit("end");
      this.stderr.emit("end");
      this.emit("close", opts.exitCode ?? 0);
    }, delay);
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.killSignal = signal;
    setTimeout(() => this.emit("close", null), 0);
    return true;
  }
}

const validReport: WeeklyReport = {
  developer_handle: "naznajmuddin",
  week_start_date: "2026-05-04",
  summary:
    "Naz had a strong week — the team's cost-recovery flow now lets accounts staff verify each charge with a manager approving each item first, replacing the prior all-or-nothing approach. Naz also shipped a control panel that lets the team turn any feature on or off across the whole platform without a release. Steady momentum, with the cost-recovery work the headline change. The supporting attendance log and inventory screens are smaller bets but tie to the same operations focus.",
  momentum: "accelerating",
  top_themes: [
    "cost-recovery flow rebuild",
    "platform feature toggles",
    "operations tooling",
  ],
  generator_version: "ignored-from-model",
};

function envelope(reportLike: unknown): string {
  const inner =
    typeof reportLike === "string" ? reportLike : JSON.stringify(reportLike);
  return JSON.stringify({ result: inner });
}

const baseInput: AnalyzeWeeklyInput = {
  developer_handle: "naznajmuddin",
  week_start_date: "2026-05-04",
  display_name: "Naz Najmuddin",
  days: [
    {
      report_date: "2026-05-04",
      summary: "Naz worked on cost-recovery permissions.",
      trajectory: "on_track",
      metrics: {
        commits_today: 4,
        commits_yesterday: 2,
        lines_added_today: 320,
        lines_removed_today: 80,
        files_touched_today: ["apps/web/cost-recovery/page.tsx"],
      },
      parse_failed: false,
    },
    {
      report_date: "2026-05-05",
      summary: "Naz extended the feature-toggle panel.",
      trajectory: "ahead",
      metrics: {
        commits_today: 6,
        commits_yesterday: 4,
        lines_added_today: 540,
        lines_removed_today: 110,
        files_touched_today: ["apps/web/admin/feature-toggles.tsx"],
      },
      parse_failed: false,
    },
  ],
};

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("analyzeDevWeek", () => {
  it("happy path — returns parsed WeeklyReport, generator_version overridden", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect("parse_failed" in result).toBe(false);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.developer_handle).toBe("naznajmuddin");
    expect(result.week_start_date).toBe("2026-05-04");
    expect(result.momentum).toBe("accelerating");
    expect(result.top_themes).toHaveLength(3);
    expect(result.generator_version).toBe("v1+claude-code-headless-weekly");
  });

  it("argv shape — uses stdin for prompt, no positional prompt arg", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );

    await analyzeDevWeek(baseInput, { claudeBinary: "claude-stub" });

    const firstCallArgs = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(firstCallArgs[0]).toBe("claude-stub");
    expect(firstCallArgs[1]).toEqual(["-p", "--output-format", "json"]);

    const child = spawnMock.mock.results[0]!.value as FakeChild;
    expect(child.stdin.written).toContain("naznajmuddin");
    expect(child.stdin.written).toContain("STRICT JSON");
    expect(child.stdin.ended).toBe(true);
  });

  it("retry on bad inner JSON — second call's stdin starts with strict-preamble", async () => {
    spawnMock
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stdoutChunks: [JSON.stringify({ result: "I think the week..." })],
          }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.momentum).toBe("accelerating");

    const secondChild = spawnMock.mock.results[1]!.value as FakeChild;
    expect(
      secondChild.stdin.written.startsWith("OUTPUT STRICT JSON ONLY"),
    ).toBe(true);
  });

  it("retry on zod validation failure — second call succeeds", async () => {
    const invalidShape = { ...validReport };
    // @ts-expect-error intentional
    delete invalidShape.momentum;

    spawnMock
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(invalidShape)] }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.momentum).toBe("accelerating");
  });

  it("returns failure after two bad inner JSON attempts", async () => {
    spawnMock
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stdoutChunks: [JSON.stringify({ result: "not json one" })],
          }),
      )
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stdoutChunks: [JSON.stringify({ result: "not json two" })],
          }),
      );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect("parse_failed" in result).toBe(true);
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.parse_failed).toBe(true);
    expect(result.developer_handle).toBe("naznajmuddin");
    expect(result.week_start_date).toBe("2026-05-04");
    expect(result.error_msg).toMatch(/JSON parse failed twice/);
  });

  it("strips ```json markdown fence before parse — happy path on first try", async () => {
    const fenced = "```json\n" + JSON.stringify(validReport) + "\n```";
    spawnMock.mockImplementationOnce(
      () =>
        new FakeChild({
          stdoutChunks: [JSON.stringify({ result: fenced })],
        }),
    );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.momentum).toBe("accelerating");
  });

  it("retries on timeout — first hangs, second succeeds", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.momentum).toBe("accelerating");
  });

  it("returns failure when both attempts time out", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(() => new FakeChild({ hang: true }));

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect("parse_failed" in result).toBe(true);
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.error_msg).toMatch(/timeout/i);
  });

  it("retries on spawn exit non-zero, then succeeds", async () => {
    spawnMock
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stderrChunks: ["boom"],
            exitCode: 1,
          }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevWeek(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected WeeklyReport");
    expect(result.momentum).toBe("accelerating");
  });
});

describe("buildWeeklyPrompt — Boss-readable structure (ADR 015 + weekly-specific)", () => {
  it("uses first name when display_name provided", () => {
    const prompt = buildWeeklyPrompt({ ...baseInput, display_name: "Naz Najmuddin" });
    expect(prompt).toContain("First name (use this in the summary): Naz");
    expect((prompt.match(/Naz/g) ?? []).length).toBeGreaterThan(3);
  });

  it("falls back to handle when display_name missing", () => {
    const { display_name: _ignored, ...inputNoName } = baseInput;
    const prompt = buildWeeklyPrompt(inputNoName);
    expect(prompt).toContain(
      "First name (use this in the summary): naznajmuddin",
    );
  });

  it("uses 100-180 word budget (wider than daily's 60-100)", () => {
    const prompt = buildWeeklyPrompt(baseInput);
    expect(prompt).toContain("100-180 words");
    expect(prompt).not.toContain("60-100 words");
  });

  it("includes weekly-specific output fields (momentum + top_themes)", () => {
    const prompt = buildWeeklyPrompt(baseInput);
    expect(prompt).toContain("momentum");
    expect(prompt).toContain("accelerating");
    expect(prompt).toContain("top_themes");
  });

  it("includes the BLUF + business-language + banned-words instructions", () => {
    const prompt = buildWeeklyPrompt({ ...baseInput, display_name: "Naz Najmuddin" });
    expect(prompt).toContain("BLUF");
    expect(prompt).toContain("Business language");
    expect(prompt).toContain("Banned words");
  });

  it("preserves the cold-context constraint (no commit messages, no chat)", () => {
    const prompt = buildWeeklyPrompt(baseInput);
    expect(prompt).toContain("daily summaries");
    expect(prompt).toContain("commit messages");
  });

  it("includes per-day input rows for each day in the week", () => {
    const prompt = buildWeeklyPrompt(baseInput);
    expect(prompt).toContain("2026-05-04");
    expect(prompt).toContain("2026-05-05");
    expect(prompt).toContain("cost-recovery permissions");
  });
});
