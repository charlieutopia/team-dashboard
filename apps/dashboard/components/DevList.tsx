'use client';

import { useMemo, useState } from 'react';
import { DevCard } from './DevCard';
import type { DevReportRow } from '@/lib/queries';

export function DevList({ rows }: { rows: DevReportRow[] }) {
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
            placeholder="Search a developer by name…"
            className="w-full text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            aria-label="Search developers"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {q && (
          <p className="text-[11px] text-gray-500 mt-1.5">
            Showing {filtered.length} of {rows.length} developers
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-500">
          No developer matches &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div>
          {filtered.map(r => (
            <DevCard key={r.developer_id} report={r} />
          ))}
        </div>
      )}
    </>
  );
}
