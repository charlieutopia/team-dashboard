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
const { analyzeDevDay } = await import("../analyze.js");
type AnalyzeInput = Parameters<typeof analyzeDevDay>[0];

interface FakeChildOptions {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  hang?: boolean;
  emitDelayMs?: number;
}

class FakeChild extends EventEmitter {
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
    // Simulate the OS reaping the process: emit close shortly after kill.
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

  it("retry on bad inner JSON — second call uses strict-preamble prompt", async () => {
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

    const secondCallArgs = spawnMock.mock.calls[1] as unknown as [
      string,
      string[],
    ];
    const argv = secondCallArgs[1];
    // -p prompt is one of the argv entries; locate it.
    const pIdx = argv.indexOf("-p");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    const prompt = argv[pIdx + 1] ?? "";
    expect(prompt.startsWith("OUTPUT STRICT JSON ONLY")).toBe(true);
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
