import type { QualityBand } from "@team-dashboard/shared";

// Test Discipline — the first Phase 2 quality signal. Pure (no IO): given the
// per-branch file lists for one developer's week, it answers "how often did
// code land WITH a test in the same branch?".
//
// The rule is deliberately coarse — branch-level co-location, not line coverage.
// A branch counts as test-backed if it touched at least one test file AND at
// least one source file. Branches that touched no source file at all (pure
// docs, pure config, test-only refactors) are excluded from the denominator so
// they neither help nor hurt the score.

// A file path is a TEST file if it carries a conventional test marker:
//   - a `.test.` or `.spec.` segment (foo.test.ts, foo.spec.tsx, ...)
//   - or lives under a `__tests__/` directory anywhere in the path.
const TEST_FILE_RE = /(\.test\.|\.spec\.|(^|\/)__tests__\/)/i;

// Extensions we treat as SOURCE code. A file is "source" only if it is a code
// file by extension AND is not itself a test file. Docs/config/lock/data files
// (.md, .json, .yml, .yaml, .lock, .txt) and images never count as source, so a
// branch that only edits a README or a config file has no source files and is
// excluded from the denominator.
const SOURCE_EXTENSIONS = new Set<string>([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "rb",
  "java",
  "kt",
  "php",
  "cs",
  "swift",
  "rs",
  "vue",
  "svelte",
]);

function extensionOf(path: string): string {
  // Strip any directory prefix, then take the substring after the last dot.
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no extension, or a dotfile like ".gitignore"
  return base.slice(dot + 1).toLowerCase();
}

export function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path);
}

export function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  return SOURCE_EXTENSIONS.has(extensionOf(path));
}

export function computeTestDiscipline(
  branches: { files_touched: string[] }[],
): { band: QualityBand; evidence: string } {
  let covered = 0; // branch has BOTH a source file and a test file
  let uncovered = 0; // branch has source file(s) but NO test file

  for (const branch of branches) {
    const files = branch.files_touched ?? [];
    const hasSource = files.some(isSourceFile);
    if (!hasSource) {
      // Test-only / docs-only / config-only branch — excluded from the score.
      continue;
    }
    const hasTest = files.some(isTestFile);
    if (hasTest) {
      covered += 1;
    } else {
      uncovered += 1;
    }
  }

  const denominator = covered + uncovered;
  if (denominator === 0) {
    return { band: "skipped", evidence: "no code branches this week" };
  }

  const coverageRate = covered / denominator;
  const band: QualityBand =
    coverageRate >= 0.8
      ? "strong"
      : coverageRate >= 0.5
        ? "solid"
        : coverageRate >= 0.2
          ? "developing"
          : "weak";

  const pct = Math.round(coverageRate * 100);
  const evidence = `${covered} of ${denominator} code branches shipped with tests (${pct}%)`;

  return { band, evidence };
}
