import Link from 'next/link';
import { TrajectoryDot } from './TrajectoryDot';
import { TodayStatusPill } from './TodayStatusPill';
import { DevBranchList } from './DevBranchList';
import type { ActiveBranchRow, DevReportRow, TodayDevStatus } from '@/lib/queries';

export function DevCard({
  report,
  todayStatus,
  branches,
}: {
  report: DevReportRow;
  todayStatus?: TodayDevStatus;
  branches?: ActiveBranchRow[];
}) {
  if (report.parse_failed) {
    return <FailedCard report={report} todayStatus={todayStatus} branches={branches} />;
  }

  const m = report.metrics ?? {};
  const sp = report.spec_progress ?? { advancing: [], drifting: [] };
  const drillHref = `/dev/${report.developer_handle}`;

  return (
    <article className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-3 mx-3 shadow-sm relative">
      <Link
        href={drillHref}
        className="block active:opacity-80 transition -m-4 mb-0 p-4 pb-0 rounded-t-xl"
        aria-label={`View ${report.display_name}'s timeline`}
      >
        <span aria-hidden className="absolute top-3 right-3 text-gray-400 text-sm">→</span>
        <header className="flex items-center gap-3 mb-3">
          <TrajectoryDot trajectory={report.trajectory} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold leading-tight">{report.display_name}</h2>
              {todayStatus && <TodayStatusPill status={todayStatus} />}
            </div>
            <p className="text-xs text-gray-500">@{report.developer_handle}</p>
          </div>
        </header>

        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{report.summary}</p>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-gray-500">Commits</dt>
            <dd className="font-medium">{m.commits_today ?? 0} <span className="text-gray-400">(was {m.commits_yesterday ?? 0})</span></dd>
          </div>
          <div>
            <dt className="text-gray-500">Lines</dt>
            <dd className="font-medium"><span className="text-green-600">+{m.lines_added_today ?? 0}</span> <span className="text-red-600">-{m.lines_removed_today ?? 0}</span></dd>
          </div>
          <div>
            <dt className="text-gray-500">Files</dt>
            <dd className="font-medium">{(m.files_touched_today ?? []).length}</dd>
          </div>
        </dl>

        <p className="mt-2 text-xs text-gray-600">
          Advancing <span className="font-semibold">{(sp.advancing ?? []).length}</span> · Drifting <span className="font-semibold text-amber-600">{report.drift_count}</span>
        </p>
      </Link>

      {branches && <DevBranchList branches={branches} />}

      <details className="mt-3">
        <summary className="text-xs text-blue-600 cursor-pointer select-none hover:text-blue-700">Tap to expand</summary>
        <ExpandedSection report={report} />
      </details>
    </article>
  );
}

function FailedCard({
  report,
  todayStatus,
  branches,
}: {
  report: DevReportRow;
  todayStatus?: TodayDevStatus;
  branches?: ActiveBranchRow[];
}) {
  return (
    <article className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-4 mb-3 mx-3 shadow-sm relative">
      <Link
        href={`/dev/${report.developer_handle}`}
        className="block -m-4 mb-0 p-4 pb-0 rounded-t-xl active:opacity-80 transition"
        aria-label={`View ${report.display_name}'s timeline`}
      >
        <span aria-hidden className="absolute top-3 right-3 text-gray-400 text-sm">→</span>
        <header className="flex items-center gap-3 mb-2">
          <span className="inline-block w-3 h-3 rounded-full bg-red-400" aria-label="failed" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold leading-tight">{report.display_name}</h2>
              {todayStatus && <TodayStatusPill status={todayStatus} />}
            </div>
            <p className="text-xs text-gray-500">@{report.developer_handle}</p>
          </div>
        </header>
        <p className="text-xs text-red-700 dark:text-red-300">
          Report generation failed.
        </p>
        {report.error_msg && (
          <p className="mt-1 text-xs font-mono text-red-600 dark:text-red-400 break-all">
            {report.error_msg}
          </p>
        )}
      </Link>
      {branches && <DevBranchList branches={branches} />}
    </article>
  );
}

function ExpandedSection({ report }: { report: DevReportRow }) {
  const sp = report.spec_progress ?? { advancing: [], drifting: [] };
  return (
    <div className="mt-3 space-y-3 text-xs">
      {sp.advancing && sp.advancing.length > 0 && (
        <div>
          <h3 className="font-semibold text-green-700 mb-1">Advancing</h3>
          <ul className="space-y-1">
            {sp.advancing.map((a: any, i: number) => (
              <li key={i}>
                <span className="font-mono text-gray-600">{a.spec_item_path}</span> — {a.advance_evidence}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sp.drifting && sp.drifting.length > 0 && (
        <div>
          <h3 className="font-semibold text-amber-700 mb-1">Drifting</h3>
          <ul className="space-y-1">
            {sp.drifting.map((d: any, i: number) => (
              <li key={i}>
                <span className="font-mono text-gray-600">{d.spec_item_path}</span> — {d.drift_evidence}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-gray-400 mt-2">Generator version: {report.generator_version}</p>
    </div>
  );
}
