const COLOR_MAP = {
  on_track: 'bg-green-500',
  ahead: 'bg-blue-500',
  behind: 'bg-amber-500',
  stuck: 'bg-red-500',
  no_activity: 'bg-gray-400',
};

export function TrajectoryDot({ trajectory }: { trajectory: keyof typeof COLOR_MAP }) {
  return <span className={`inline-block w-3 h-3 rounded-full ${COLOR_MAP[trajectory]}`} aria-label={trajectory} />;
}
