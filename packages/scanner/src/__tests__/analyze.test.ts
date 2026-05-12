import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { DailyReport } from "@team-dashboard/shared";

// vi.mock factories are hoisted; keep state external so tests can swap behavior.
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER mocks are registered.
const { analyzeDevDay, stripMarkdownFences, firstNameFrom, buildPrompt } =
  await import("../analyze.js");
type AnalyzeInput = Parameters<typeof analyzeDevDay>[0];

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
    if (opts.hang) {
      // never emits close
      return;
    }
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

const validReport: DailyReport = {
  developer_handle: "naznajmuddin",
  date: "2026-05-10",
  summary:
    "naznajmuddin shipped focused work on the inbox refactor today. The diff touches three files in the conversation pipeline and removes a stale flag. Yesterday saw a single commit; today brings four commits totalling 220 added and 60 removed lines, which suggests steady forward motion. The branch base matches main, and nothing in the diff hints at a stalled rebase or abandoned exploration. The spec area covered (inbox/conversation routing) maps cleanly onto the file paths touched, so progress is on-spec. No blocker keywords are present in the change set. Trajectory looks on track for the iteration window.",
  metrics: {
    commits_today: 4,
    commits_yesterday: 1,
    lines_added_today: 220,
    lines_removed_today: 60,
    files_touched_today: ["apps/web/src/inbox/router.ts"],
  },
  spec_progress: {
    advancing: [
      {
        spec_item_path: "inbox/routing",
        advance_evidence: "router.ts now resolves to the new handler",
      },
    ],
    drifting: [],
  },
  trajectory: "on_track",
  generator_version: "ignored-from-model",
};

function envelope(reportLike: unknown): string {
  const inner =
    typeof reportLike === "string" ? reportLike : JSON.stringify(reportLike);
  return JSON.stringify({ result: inner });
}

const baseInput: AnalyzeInput = {
  developer_handle: "naznajmuddin",
  date: "2026-05-10",
  repo_full_name: "utopiabuilder/utopiaspace",
  branches: [
    {
      branch_name: "feat/inbox-routing",
      head_sha: "deadbeef",
      base_sha: "cafef00d",
      diff_text: "diff --git a/apps/web/src/inbox/router.ts ...",
    },
  ],
  spec_text: "Inbox routing must use the new handler.",
};

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("analyzeDevDay", () => {
  it("happy path — returns parsed DailyReport, generator_version overridden", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect("parse_failed" in result).toBe(false);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.developer_handle).toBe("naznajmuddin");
    expect(result.date).toBe("2026-05-10");
    expect(result.trajectory).toBe("on_track");
    expect(result.metrics.commits_today).toBe(4);
    expect(result.spec_progress.advancing).toHaveLength(1);
    expect(result.generator_version).toBe("v1+claude-code-headless");
  });

  it("argv shape — uses stdin for prompt, no positional prompt arg (E2BIG fix)", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
    );

    await analyzeDevDay(baseInput, { claudeBinary: "claude-stub" });

    const firstCallArgs = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(firstCallArgs[0]).toBe("claude-stub");
    // argv must be exactly ["-p", "--output-format", "json"] — no prompt positional
    expect(firstCallArgs[1]).toEqual(["-p", "--output-format", "json"]);

    // Prompt was written to stdin and contains the developer identity + strict-output marker
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
            stdoutChunks: [
              JSON.stringify({ result: "I think the report is..." }),
            ],
          }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.trajectory).toBe("on_track");

    // Second call's stdin starts with the strict preamble
    const secondChild = spawnMock.mock.results[1]!.value as FakeChild;
    expect(secondChild.stdin.written.startsWith("OUTPUT STRICT JSON ONLY")).toBe(
      true,
    );
  });

  it("retry on zod validation failure — second call succeeds", async () => {
    const invalidShape = { ...validReport };
    // Strip metrics — zod should reject.
    // @ts-expect-error intentional
    delete invalidShape.metrics;

    spawnMock
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(invalidShape)] }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.metrics.commits_today).toBe(4);
  });

  it("returns AnalyzeFailure after two bad inner JSON attempts", async () => {
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

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect("parse_failed" in result).toBe(true);
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.parse_failed).toBe(true);
    expect(result.developer_handle).toBe("naznajmuddin");
    expect(result.date).toBe("2026-05-10");
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

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.trajectory).toBe("on_track");
  });

  it("retries on timeout — first hangs, second succeeds", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validReport)] }),
      );

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.trajectory).toBe("on_track");
  });

  it("returns AnalyzeFailure when both attempts time out", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(() => new FakeChild({ hang: true }));

    const result = await analyzeDevDay(baseInput, {
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

    const result = await analyzeDevDay(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected DailyReport");
    expect(result.trajectory).toBe("on_track");
  });
});

describe("firstNameFrom (exported helper)", () => {
  it("returns first whitespace-separated token of display_name", () => {
    expect(firstNameFrom("Naz Najmuddin", "naznajmuddin")).toBe("Naz");
    expect(firstNameFrom("Aliesa", "rjnraliesa")).toBe("Aliesa");
    expect(firstNameFrom("Mary  Anne  O'Brien", "mob")).toBe("Mary");
  });

  it("falls back to githubHandle when display_name missing or blank", () => {
    expect(firstNameFrom(undefined, "naznajmuddin")).toBe("naznajmuddin");
    expect(firstNameFrom("", "naznajmuddin")).toBe("naznajmuddin");
    expect(firstNameFrom("   ", "naznajmuddin")).toBe("naznajmuddin");
  });
});

describe("buildPrompt — Boss-readable prompt structure", () => {
  it("uses first name when display_name provided", () => {
    const prompt = buildPrompt({ ...baseInput, display_name: "Naz Najmuddin" });
    expect(prompt).toContain("First name (use this in the summary): Naz");
    // Examples and the SUMMARY RULES should reference the first name multiple times
    expect((prompt.match(/Naz/g) ?? []).length).toBeGreaterThan(3);
  });

  it("falls back to handle when display_name missing", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("First name (use this in the summary): naznajmuddin");
  });

  it("includes the BLUF + business-language + banned-words instructions", () => {
    const prompt = buildPrompt({ ...baseInput, display_name: "Naz Najmuddin" });
    expect(prompt).toContain("BLUF");
    expect(prompt).toContain("Business language");
    expect(prompt).toContain("Banned words");
    expect(prompt).toContain("60-100 words");
  });

  it("preserves the cold-context constraint", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("ONLY the diffs");
    expect(prompt).toContain("IGNORE commit messages");
  });
});

describe("stripMarkdownFences (exported helper)", () => {
  it("strips ```json wrapper", () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripMarkdownFences(input)).toBe('{"a":1}');
  });

  it("strips bare ``` wrapper", () => {
    const input = '```\n{"a":1}\n```';
    expect(stripMarkdownFences(input)).toBe('{"a":1}');
  });

  it("returns unchanged when no fence present", () => {
    expect(stripMarkdownFences('{"a":1}')).toBe('{"a":1}');
    expect(stripMarkdownFences('  {"a":1}  ')).toBe('{"a":1}'); // trims whitespace
  });
});
