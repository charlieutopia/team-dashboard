import type { JobState } from '@/lib/data';

const DOT: Record<JobState, string> = {
  ok: 'bg-state-ok',
  fail: 'bg-state-fail',
  disabled: 'bg-state-disabled',
  scheduled: 'bg-state-scheduled',
};

// Coloured state dot + capitalised label, matching the prototype legend:
// green ok / red fail / grey disabled / blue scheduled.
export function StateDot({ state }: { state: JobState }) {
  const dot = DOT[state] ?? 'bg-state-disabled';
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <i className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="text-[13px] capitalize">{state}</span>
    </span>
  );
}
