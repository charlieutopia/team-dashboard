import { describe, it, expect } from "vitest";
import { computeTestDiscipline } from "../quality/test-discipline.js";

// Helper: a branch with the given file list.
function b(...files: string[]): { files_touched: string[] } {
  return { files_touched: files };
}

// A branch that ships code WITH a test (counts as covered).
const covered = () => b("src/foo.ts", "src/__tests__/foo.test.ts");
// A branch that ships code with NO test (counts as uncovered).
const uncovered = () => b("src/bar.ts");

describe("computeTestDiscipline", () => {
  it("strong: >= 80% of code branches have tests", () => {
    // 4 covered, 1 uncovered → 4/5 = 80%.
    const branches = [
      covered(),
      covered(),
      covered(),
      covered(),
      uncovered(),
    ];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("strong");
    expect(out.evidence).toBe(
      "4 of 5 code branches shipped with tests (80%)",
    );
  });

  it("solid: >= 50% but < 80%", () => {
    // 3 covered, 2 uncovered → 3/5 = 60%.
    const branches = [
      covered(),
      covered(),
      covered(),
      uncovered(),
      uncovered(),
    ];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("solid");
    expect(out.evidence).toBe(
      "3 of 5 code branches shipped with tests (60%)",
    );
  });

  it("developing: >= 20% but < 50%", () => {
    // 1 covered, 3 uncovered → 1/4 = 25%.
    const branches = [covered(), uncovered(), uncovered(), uncovered()];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("developing");
    expect(out.evidence).toBe(
      "1 of 4 code branches shipped with tests (25%)",
    );
  });

  it("weak: < 20%", () => {
    // 1 covered, 9 uncovered → 1/10 = 10%.
    const branches = [
      covered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
      uncovered(),
    ];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("weak");
    expect(out.evidence).toBe(
      "1 of 10 code branches shipped with tests (10%)",
    );
  });

  it("skipped: zero code branches → denominator 0", () => {
    // Only docs/config branches — no source files anywhere.
    const branches = [
      b("README.md", "package.json"),
      b("docs/guide.md"),
      b("config.yaml", "data.json"),
    ];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("skipped");
    expect(out.evidence).toBe("no code branches this week");
  });

  it("test-only branches are excluded from the denominator", () => {
    // 1 covered, 1 uncovered (real code branches) → 1/2 = 50% = solid.
    // The two test-only branches touch no source file, so they neither help
    // nor hurt — they must NOT inflate the denominator to 4.
    const branches = [
      covered(),
      uncovered(),
      b("src/__tests__/extra.test.ts"), // test-only, excluded
      b("packages/x/foo.spec.ts"), // test-only, excluded
    ];
    const out = computeTestDiscipline(branches);
    expect(out.band).toBe("solid");
    expect(out.evidence).toBe(
      "1 of 2 code branches shipped with tests (50%)",
    );
  });

  it("empty input → skipped", () => {
    const out = computeTestDiscipline([]);
    expect(out.band).toBe("skipped");
    expect(out.evidence).toBe("no code branches this week");
  });
});
