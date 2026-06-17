import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock factories are hoisted; keep state external so tests can swap behavior.
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER mocks are registered.
const { analyzeDevQuality, buildQualityPrompt } = await import(
  "../analyze-quality.js"
);
type AnalyzeQualityInput = Parameters<typeof analyzeDevQuality>[0];

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

const validQualityReport = {
  developer_handle: "iszuwe",
  week_start_date: "2026-06-08",
  code_care_band: "solid",
  code_care_evidence: "Handled the empty case and checked inputs before saving.",
  clarity_band: "solid",
  clarity_evidence: "Changes were focused and described clearly.",
  stability_band: "strong",
  stability_evidence: "Nothing shipped this week needed an urgent fix afterward.",
  headline: "Solid, careful week for Izz — the overtime flow looks well-built.",
  needs_a_chat: false,
  generator_version: "ignored-from-model",
};

function envelope(reportLike: unknown): string {
  const inner =
    typeof reportLike === "string" ? reportLike : JSON.stringify(reportLike);
  return JSON.stringify({ result: inner });
}

const baseInput: AnalyzeQualityInput = {
  developer_handle: "iszuwe",
  week_start_date: "2026-06-08",
  display_name: "Izz",
  level: "junior",
  branches: [
    {
      branch_name: "feat/overtime",
      repo_full_name: "utopiabuilder/utopiaspace",
      head_sha: "aaaaaaa",
      base_sha: "bbbbbbb",
      diff_text: "+ function applyOvertime(hours) { if (hours <= 0) return; }",
      commit_subjects: ["feat: overtime apply flow", "fix: guard zero hours"],
    },
  ],
};

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("analyzeDevQuality", () => {
  it("happy path — parsed quality report, generator_version overridden", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validQualityReport)] }),
    );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.developer_handle).toBe("iszuwe");
    expect(result.week_start_date).toBe("2026-06-08");
    expect(result.code_care_band).toBe("solid");
    expect(result.clarity_band).toBe("solid");
    expect(result.stability_band).toBe("strong");
    expect(result.needs_a_chat).toBe(false);
    expect(result.generator_version).toBe("v1+claude-code-headless-quality");
  });

  it("argv shape — stdin prompt, opus-4-8 model, no positional prompt arg", async () => {
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [envelope(validQualityReport)] }),
    );

    await analyzeDevQuality(baseInput, { claudeBinary: "claude-stub" });

    const firstCallArgs = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(firstCallArgs[0]).toBe("claude-stub");
    expect(firstCallArgs[1]).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-8",
    ]);

    const child = spawnMock.mock.results[0]!.value as FakeChild;
    expect(child.stdin.written).toContain("iszuwe");
    expect(child.stdin.ended).toBe(true);
  });

  it("SKIPPED short-circuit — no code branches => all-skipped WITHOUT spawning the model", async () => {
    const noCode: AnalyzeQualityInput = {
      ...baseInput,
      branches: [
        {
          branch_name: "docs/readme",
          repo_full_name: "utopiabuilder/utopiaspace",
          head_sha: "a",
          base_sha: "b",
          diff_text: "   ",
          commit_subjects: ["docs: update readme"],
        },
      ],
    };

    const result = await analyzeDevQuality(noCode, { claudeBinary: "claude-stub" });

    expect(spawnMock).not.toHaveBeenCalled();
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.code_care_band).toBe("skipped");
    expect(result.clarity_band).toBe("skipped");
    expect(result.stability_band).toBe("skipped");
    expect(result.needs_a_chat).toBe(false);
  });

  it("retry on bad inner JSON — second call prepends the strict preamble", async () => {
    spawnMock
      .mockImplementationOnce(
        () =>
          new FakeChild({
            stdoutChunks: [JSON.stringify({ result: "Well, the code is..." })],
          }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validQualityReport)] }),
      );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.code_care_band).toBe("solid");

    const secondChild = spawnMock.mock.results[1]!.value as FakeChild;
    expect(secondChild.stdin.written.startsWith("OUTPUT STRICT JSON ONLY")).toBe(
      true,
    );
  });

  it("retry on zod validation failure (bad band enum) — second succeeds", async () => {
    const invalid = { ...validQualityReport, code_care_band: "amazing" };

    spawnMock
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(invalid)] }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validQualityReport)] }),
      );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.code_care_band).toBe("solid");
  });

  it("returns failure after two bad attempts", async () => {
    spawnMock
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [JSON.stringify({ result: "nope one" })] }),
      )
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [JSON.stringify({ result: "nope two" })] }),
      );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if (!("parse_failed" in result)) throw new Error("expected failure");
    expect(result.parse_failed).toBe(true);
    expect(result.developer_handle).toBe("iszuwe");
    expect(result.week_start_date).toBe("2026-06-08");
  });

  it("strips ```json fence before parse — happy on first try", async () => {
    const fenced = "```json\n" + JSON.stringify(validQualityReport) + "\n```";
    spawnMock.mockImplementationOnce(
      () => new FakeChild({ stdoutChunks: [JSON.stringify({ result: fenced })] }),
    );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.stability_band).toBe("strong");
  });

  it("retries on timeout — first hangs, second succeeds", async () => {
    spawnMock
      .mockImplementationOnce(() => new FakeChild({ hang: true }))
      .mockImplementationOnce(
        () => new FakeChild({ stdoutChunks: [envelope(validQualityReport)] }),
      );

    const result = await analyzeDevQuality(baseInput, {
      claudeBinary: "claude-stub",
      timeoutMs: 50,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    if ("parse_failed" in result) throw new Error("expected quality report");
    expect(result.code_care_band).toBe("solid");
  });
});

describe("buildQualityPrompt — fairness + dimension structure", () => {
  it("uses first name + level as context", () => {
    const prompt = buildQualityPrompt(baseInput);
    expect(prompt).toContain("Izz");
    expect(prompt).toContain("junior");
  });

  it("defines all three AI dimensions", () => {
    const prompt = buildQualityPrompt(baseInput);
    expect(prompt).toContain("Code Care");
    expect(prompt).toContain("Clarity");
    expect(prompt).toContain("Stability");
  });

  it("carries the fairness rules — conservative, level-aware, do-not-punish-fixing-others", () => {
    const prompt = buildQualityPrompt(baseInput).toLowerCase();
    expect(prompt).toContain("coaching");
    expect(prompt).toContain("benefit of the doubt");
    // a senior who fixes other people's bugs must not look unstable
    expect(prompt).toContain("other");
    expect(prompt).toContain("fair");
  });

  it("includes the diff text and commit subjects as ground truth", () => {
    const prompt = buildQualityPrompt(baseInput);
    expect(prompt).toContain("applyOvertime");
    expect(prompt).toContain("overtime apply flow");
  });

  it("bans tech jargon in the Charlie-facing headline", () => {
    const prompt = buildQualityPrompt(baseInput);
    expect(prompt).toContain("Banned words");
  });

  it("enumerates the strict JSON output fields", () => {
    const prompt = buildQualityPrompt(baseInput);
    expect(prompt).toContain("code_care_band");
    expect(prompt).toContain("clarity_evidence");
    expect(prompt).toContain("stability_band");
    expect(prompt).toContain("headline");
    expect(prompt).toContain("needs_a_chat");
  });
});
