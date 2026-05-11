const COLOR_MAP: Record<string, string> = {
  on_track: 'bg-green-500',
  ahead: 'bg-blue-500',
  behind: 'bg-amber-500',
  stuck: 'bg-red-500',
  no_activity: 'bg-gray-400',
};

export function TrajectoryDot({ trajectory }: { trajectory: string | null }) {
  const cls = trajectory ? COLOR_MAP[trajectory] ?? 'bg-gray-300' : 'bg-gray-300';
  return <span className={`inline-block w-3 h-3 rounded-full ${cls}`} aria-label={trajectory ?? 'unknown'} />;
}
