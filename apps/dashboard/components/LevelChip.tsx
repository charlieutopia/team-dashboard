import type { DevLevel } from '@/lib/queries';

const LEVEL_LABELS: Record<DevLevel, string> = {
  intern: 'Intern',
  junior: 'Junior',
  senior: 'Senior',
  freelancer: 'Freelancer',
};

/**
 * Small muted CONTEXT chip showing a developer's seniority level next to their
 * name. Purely informational — never a score adjustment. Renders nothing when
 * the level is unset (null).
 */
export function LevelChip({ level }: { level: DevLevel | null }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-app px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
      {LEVEL_LABELS[level]}
    </span>
  );
}
