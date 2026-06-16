import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { MonthlyReport } from "@team-dashboard/shared";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { analyzeDevMonth, buildMonthlyPrompt } = await import(
  "../analyze-monthly.js"
);
type AnalyzeMonthlyInput = Parameters<typeof analyzeDevMonth>[0];

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

const validReport: MonthlyReport = {
  developer_handle: "naznajmuddin",
  month_start_date: "2026-04-01",
  summary:
    "Nazwa had a strong month — the customer messaging flow shipped in two phases and the operations tooling rebuild made meaningful progress. The first half of the month focused on the messaging routing changes, with the second half splitting between the manager-approval rebuild and the staff attendance log. Pace picked up notably in the second half of the month, with several days of high output and no stretch of more than two quiet days in a row. The work lines up with what the spec asks for, and there were no blockers reported across the four weeks.",
  momentum: "accelerating",
  top_themes: [
    "customer messaging flow",
    "manager approval rebuild",
    "operations tooling",
    "staff attendance log",
  ],
  generator_version: "ignored-from-model",
};

function envelope(reportLike: unknown): string {
  const inner =
    typeof reportLike === "string" ? reportLike : JSON.stringify(reportLike);
  return JSON.stringify({ result: inner });
}

const baseInput: AnalyzeMonthlyInput = {
  developer_handle: "naznajmuddin",
  month_start_date: "2026-04-01",
  display_name: "Nazwa Najmuddin",
  days: [
    {
      report_date: "2026-04-02",
      summary: "Nazwa shipped routing v1.",
      trajectory: "on_track",
      metrics: {
        commits_today: 3,
        commits_yesterday: 1,
        lines_added_today: 240,
        lines_removed_today: 40,
        files_touched_today: ["a.ts"],
      },
      parse_failed: false,
    },
    {
      report_date: "2026-04-15",
      summary: "Nazwa extended the manager approval rebuild.",
      trajectory: "ahead",
      metrics: {
        commits_today: 5,
        commits_yesterday: 3,
        lines_added_today: 480,
        lines_removed_today: 90,
        files_touched_today: ["b.ts"],
      },
      parse_failed: false,
    },
  ],
  weeks: [
    {
      week_start_date: "2026-03-30",
      summary: "Nazwa shipped routing v1.",
      momentum: "steady",
      top_themes: ["customer messaging flow"],
    },
    {
      week_start_date: "2026-04-13",
      summary: "Nazwa shipped manager approval.",
      momentum: "accelerating",
      top_themes: ["manager approval rebuild"],
    },
  ],
  total_working_days_in_month: 21,
  total_on_leave_days_in_month: 1,
};

beforeEach(() => {
  spawnMock.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
});

describe("analyzeDevMonth", () => {
  it("happy path — returns parsed MonthlyReport, generator_version overridden", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
    expect(result.developer_handle).toBe("naznajmuddin");
    expect(result.month_start_date).toBe("2026-04-01");
    expect(result.momentum).toBe("accelerating");
    expect(result.top_themes).toHaveLength(4);
    expect(result.generator_version).toBe("v1+claude-code-headless-monthly");
  });

  it("argv shape — uses stdin for prompt", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );
    await analyzeDevMonth(baseInput, { claudeBinary: "claude-stub" });
    const firstCallArgs = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(firstCallArgs[1]).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-8",
    ]);
    const child = spawnMock.mock.results[0]!.value as FakeChild;
    expect(child.stdin.written).toContain("naznajmuddin");
    expect(child.stdin.written).toContain("STRICT JSON");
    expect(child.stdin.ended).toBe(true);
  });

  it("retry on bad inner JSON — second call starts with strict-preamble", async () => {
    spawnMock
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stdoutChunks: [JSON.stringify({ result: "I think the month was..." })],
          }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
    const secondChild = spawnMock.mock.results[1]!.value as FakeChild;
    expect(secondChild.stdin.written.startsWith("OUTPUT STRICT JSON ONLY")).toBe(
      true,
    );
  });

  it("retry on zod validation failure — second succeeds", async () => {
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
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
    expect(result.momentum).toBe("accelerating");
  });

  it("returns failure after two bad JSON attempts", async () => {
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
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect("parse_failed" in result).toBe(true);
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.error_msg).toMatch(/JSON parse failed twice/);
    expect(result.month_start_date).toBe("2026-04-01");
  });

  it("strips markdown fence before parse", async () => {
    const fenced = "```json\n" + JSON.stringify(validReport) + "\n```";
    spawnMock.mockImplementationOnce(
      () =>
        new FakeChild({
          stdoutChunks: [JSON.stringify({ result: fenced })],
        }),
    );
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
    expect(result.momentum).toBe("accelerating");
  });

  it("retries on timeout", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
  });

  it("returns failure when both timeout", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(() => new FakeChild({ hang: true }));
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.error_msg).toMatch(/timeout/i);
  });

  it("retries on spawn-exit non-zero", async () => {
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
    const result = await analyzeDevMonth(baseInput, {
      claudeBinary: "claude-stub",
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected MonthlyReport");
  });
});

describe("buildMonthlyPrompt — Boss-readable structure", () => {
  it("uses first name when display_name provided", () => {
    const prompt = buildMonthlyPrompt({
      ...baseInput,
      display_name: "Nazwa Najmuddin",
    });
    expect(prompt).toContain("First name (use this in the summary): Nazwa");
    expect((prompt.match(/Nazwa/g) ?? []).length).toBeGreaterThan(3);
  });

  it("falls back to handle when display_name missing", () => {
    const { display_name: _ignored, ...inputNoName } = baseInput;
    const prompt = buildMonthlyPrompt(inputNoName);
    expect(prompt).toContain(
      "First name (use this in the summary): naznajmuddin",
    );
  });

  it("uses 180-280 word budget (wider than weekly's 100-180)", () => {
    const prompt = buildMonthlyPrompt(baseInput);
    expect(prompt).toContain("180-280 words");
    expect(prompt).not.toContain("100-180 words");
  });

  it("instructs trend-narrative not chronological list", () => {
    const prompt = buildMonthlyPrompt(baseInput);
    expect(prompt).toContain("TREND STORY");
    expect(prompt).toContain("not a chronological list");
  });

  it("includes weekly digests as primary input", () => {
    const prompt = buildMonthlyPrompt(baseInput);
    expect(prompt).toContain("Weekly digests");
    expect(prompt).toContain("2026-03-30");
    expect(prompt).toContain("2026-04-13");
  });

  it("includes month totals (working days, leave days)", () => {
    const prompt = buildMonthlyPrompt(baseInput);
    expect(prompt).toContain("working_days_in_month: 21");
    expect(prompt).toContain("total_on_leave_days_in_month: 1");
  });
});
