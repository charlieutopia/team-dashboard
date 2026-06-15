import Link from 'next/link';
import { DevAvatar } from './DevAvatar';
import { LevelChip } from './LevelChip';
import type { WeeklyDigestRow } from '@/lib/queries';

const MOMENTUM_BADGE: Record<string, { label: string; cls: string }> = {
  accelerating: { label: 'Accelerating', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  steady: { label: 'Steady', cls: 'bg-green-100 text-green-800 border-green-200' },
  slowing: { label: 'Slowing', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  stalled: { label: 'Stalled', cls: 'bg-red-100 text-red-800 border-red-200' },
  no_activity: { label: 'No activity', cls: 'bg-card-sunken text-ink-muted border-line' },
};

/** Identity block (avatar + name + @handle) shared by the normal + failed cards. */
function Identity({
  digest,
  showLink,
  trajectory,
}: {
  digest: WeeklyDigestRow;
  showLink: boolean;
  trajectory: 'stuck' | null;
}) {
  return (
    <header className="flex items-center gap-3">
      <DevAvatar
        displayName={digest.display_name}
        handle={digest.developer_handle}
        size="md"
        trajectory={trajectory}
      />
      <div className="flex-1 min-w-0">
        <h3 className="text-[17px] font-bold leading-tight tracking-tight text-ink">
          {showLink ? (
            <Link href={`/dev/${digest.developer_handle}`} className="hover:underline">
              {digest.display_name}
            </Link>
          ) : (
            digest.display_name
          )}
        </h3>
        <span className="text-[13px] font-medium text-ink-faint">
          @{digest.developer_handle}
        </span>
      </div>
    </header>
  );
}

export function WeeklyDigestCard({
  digest,
  showLink = true,
  compact = false,
}: {
  digest: WeeklyDigestRow;
  showLink?: boolean;
  compact?: boolean;
}) {
  if (digest.parse_failed) {
    return (
      <article className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:gap-5">
          {/* LEFT — identity */}
          <div className="sm:w-56 sm:shrink-0">
            <Identity digest={digest} showLink={showLink} trajectory="stuck" />
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <LevelChip level={digest.level} />
              <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-800 border border-red-200 rounded px-1.5 py-0.5">
                Weekly failed
              </span>
            </div>
          </div>

          {/* RIGHT — failure note */}
          <div className="flex-1 min-w-0 mt-3 sm:mt-0 sm:pr-6">
            <p className="text-[13px] text-red-700 dark:text-red-300">
              We couldn&apos;t build this week&apos;s summary for this person.
            </p>
            <p className="mt-1 text-[12px] text-ink-faint" title={digest.error_msg ?? undefined}>
              It will try again automatically.
            </p>
          </div>
        </div>
      </article>
    );
  }

  const badge = MOMENTUM_BADGE[digest.momentum ?? 'no_activity'] ?? MOMENTUM_BADGE.no_activity!;

  return (
    <article className={`rounded-2xl border border-line bg-card ${compact ? 'p-4' : 'p-5'} shadow-sm`}>
      <div className="flex flex-col sm:flex-row sm:gap-5">
        {/* LEFT — identity + level + momentum */}
        <div className="sm:w-56 sm:shrink-0">
          <Identity digest={digest} showLink={showLink} trajectory={null} />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <LevelChip level={digest.level} />
            <span
              className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${badge.cls}`}
            >
              {badge.label}
            </span>
          </div>
        </div>

        {/* RIGHT — the hero: full plain-English weekly summary */}
        <div className="flex-1 min-w-0 mt-3 sm:mt-0 sm:pr-6">
          {digest.summary ? (
            <p
              className={`text-[15px] leading-relaxed text-ink whitespace-pre-line ${
                compact ? 'line-clamp-3' : ''
              }`}
            >
              {digest.summary}
            </p>
          ) : (
            <p className="text-[13px] text-ink-faint">No summary for this week.</p>
          )}

          {digest.top_themes && digest.top_themes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {digest.top_themes.map((t, i) => (
                <span
                  key={i}
                  className="text-[11px] bg-card-sunken text-ink-muted rounded-full px-2 py-0.5"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
