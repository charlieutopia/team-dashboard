'use client';

import { useMemo, useState } from 'react';
import { DevCard } from './DevCard';
import type {
  ActiveBranchRow,
  CadenceEntry,
  DevReportRow,
  OpenPrRow,
  TodayDevStatus,
} from '@/lib/queries';

export function DevList({
  rows,
  todayStatusByDev,
  branchesByDev,
  prsByDev,
  cadenceByDev,
}: {
  rows: DevReportRow[];
  todayStatusByDev?: Record<string, TodayDevStatus>;
  branchesByDev?: Record<string, ActiveBranchRow[]>;
  prsByDev?: Record<string, OpenPrRow[]>;
  cadenceByDev?: Record<string, CadenceEntry>;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      r =>
        r.display_name.toLowerCase().includes(q) ||
        r.developer_handle.toLowerCase().includes(q),
    );
  }, [rows, q]);

  return (
    <>
      <div className="px-4 pt-2 pb-3">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find someone…"
            className="w-full text-sm rounded-md border border-line bg-card px-3 py-2 pr-8 text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            aria-label="Find a developer"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-muted text-sm"
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>
        {q && (
          <p className="text-[11px] text-ink-faint mt-1.5">
            {filtered.length} of {rows.length}
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-ink-faint">
          No one matches &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div>
          {filtered.map(r => (
            <DevCard
              key={r.developer_id}
              report={r}
              todayStatus={todayStatusByDev?.[r.developer_id]}
              branches={branchesByDev?.[r.developer_id]}
              prs={prsByDev?.[r.developer_id]}
              cadence={cadenceByDev?.[r.developer_id]}
            />
          ))}
        </div>
      )}
    </>
  );
}
