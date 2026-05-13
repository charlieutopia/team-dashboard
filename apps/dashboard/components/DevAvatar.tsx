/*
 * Per-dev visual identity primitive.
 *
 * Background hue is deterministic from the github_handle via a djb2-style
 * hash → 360 hue space. Same dev always renders the same color across reloads
 * and devices because the input string is the same; no random seed.
 *
 * The optional trajectoryRing prop draws a 2px ring around the avatar in the
 * trajectory color, so this single primitive carries both identity and status
 * (replaces the prior standalone TrajectoryDot dot).
 */

const TRAJECTORY_RING: Record<string, string> = {
  on_track: 'ring-trajectory-on_track',
  ahead: 'ring-trajectory-ahead',
  behind: 'ring-trajectory-behind',
  stuck: 'ring-trajectory-stuck',
  no_activity: 'ring-trajectory-no_activity',
};

function hashHandle(handle: string): number {
  let h = 5381;
  for (let i = 0; i < handle.length; i++) {
    h = ((h << 5) + h) ^ handle.charCodeAt(i);
  }
  return Math.abs(h);
}

function hueForHandle(handle: string): number {
  return hashHandle(handle) % 360;
}

const SIZE_MAP = {
  sm: { px: 28, font: '0.7rem' },
  md: { px: 36, font: '0.875rem' },
  lg: { px: 44, font: '1rem' },
} as const;

export function DevAvatar({
  displayName,
  handle,
  size = 'md',
  trajectory,
  className = '',
}: {
  displayName: string;
  handle: string;
  size?: 'sm' | 'md' | 'lg';
  trajectory?: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity' | null;
  className?: string;
}) {
  const initial = (displayName.trim().charAt(0) || handle.charAt(0) || '?').toUpperCase();
  const hue = hueForHandle(handle);
  const dim = SIZE_MAP[size];
  const ring = trajectory ? `ring-2 ring-offset-2 ring-offset-card ${TRAJECTORY_RING[trajectory] ?? ''}` : '';

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0 select-none ${ring} ${className}`}
      style={{
        backgroundColor: `hsl(${hue} 60% 42%)`,
        width: `${dim.px}px`,
        height: `${dim.px}px`,
        fontSize: dim.font,
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
