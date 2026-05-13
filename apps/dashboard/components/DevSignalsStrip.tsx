import type { CadenceEntry, OpenPrRow } from '@/lib/queries';

function cadenceLabel(c: CadenceEntry): {
  text: string;
  cls: string;
  arrow: string;
} | null {
  if (c.direction === 'no_data') return null;
  const sign = c.deltaPct > 0 ? '+' : '';
  const text = `commits ${sign}${c.deltaPct}% vs last week`;
  if (c.direction === 'up') {
    return {
      text,
      arrow: '↑',
      cls: 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-200 dark:border-green-800',
    };
  }
  if (c.direction === 'down') {
    return {
      text,
      arrow: '↓',
      cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800',
    };
  }
  return {
    text,
    arrow: '→',
    cls: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  };
}

export function DevSignalsStrip({
  prs,
  cadence,
  githubHandle,
  primaryRepo,
}: {
  prs?: OpenPrRow[];
  cadence?: CadenceEntry;
  githubHandle: string;
  primaryRepo?: string;
}) {
  const prCount = prs?.length ?? 0;
  const cadenceBadge = cadence ? cadenceLabel(cadence) : null;
  if (prCount === 0 && !cadenceBadge) return null;

  const prListUrl = primaryRepo
    ? `https://github.com/${primaryRepo}/pulls?q=is%3Apr+is%3Aopen+author%3A${githubHandle}`
    : `https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3A${githubHandle}`;
  const draftCount = prs?.filter(p => p.pr_state === 'draft').length ?? 0;
  const prLabel =
    draftCount > 0 && draftCount < prCount
      ? `${prCount} open PR${prCount === 1 ? '' : 's'} · ${draftCount} draft`
      : draftCount === prCount && prCount > 0
        ? `${prCount} draft PR${prCount === 1 ? '' : 's'}`
        : `${prCount} open PR${prCount === 1 ? '' : 's'}`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide">
      {prCount > 0 && (
        <a
          href={prListUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center border rounded px-1.5 py-0.5 font-medium bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800"
        >
          {prLabel}
        </a>
      )}
      {cadenceBadge && (
        <span
          className={`inline-flex items-center border rounded px-1.5 py-0.5 font-medium ${cadenceBadge.cls}`}
          title={`This week ${cadence?.thisWeek ?? 0} · last week ${cadence?.lastWeek ?? 0}`}
        >
          {cadenceBadge.arrow} {cadenceBadge.text}
        </span>
      )}
    </div>
  );
}
