import Link from 'next/link';
import { DevAvatar } from './DevAvatar';
import { TodayStatusPill } from './TodayStatusPill';
import { DevBranchList } from './DevBranchList';
import { DevSignalsStrip } from './DevSignalsStrip';
import type {
  ActiveBranchRow,
  CadenceEntry,
  DevReportRow,
  OpenPrRow,
  TodayDevStatus,
} from '@/lib/queries';

export function DevCard({
  report,
  todayStatus,
  branches,
  prs,
  cadence,
}: {
  report: DevReportRow;
  todayStatus?: TodayDevStatus;
  branches?: ActiveBranchRow[];
  prs?: OpenPrRow[];
  cadence?: CadenceEntry;
}) {
  if (report.parse_failed) {
    return <FailedCard report={report} todayStatus={todayStatus} branches={branches} prs={prs} cadence={cadence} />;
  }

  const m = report.metrics ?? {};
  const drillHref = `/dev/${report.developer_handle}`;

  return (
    <article className="rounded-xl border border-line bg-card p-5 mb-3 mx-3 shadow-sm relative">
      <Link
        href={drillHref}
        className="block active:opacity-80 transition -m-5 mb-0 p-5 pb-0 rounded-t-xl"
        aria-label={`View ${report.display_name}'s timeline`}
      >
        <span aria-hidden className="absolute top-4 right-4 text-ink-faint text-sm">→</span>
        <header className="flex items-center gap-3 mb-4">
          <DevAvatar
            displayName={report.display_name}
            handle={report.developer_handle}
            size="md"
            trajectory={report.trajectory}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-ink">{report.display_name}</h2>
              {todayStatus && <TodayStatusPill status={todayStatus} />}
            </div>
            <p className="text-xs text-ink-faint">@{report.developer_handle}</p>
          </div>
        </header>

        <p className="text-sm leading-relaxed text-ink-muted">{report.summary}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-ink-faint uppercase tracking-wide text-[10px]">Commits</dt>
            <dd className="font-medium text-ink mt-0.5">{m.commits_today ?? 0} <span className="text-ink-faint font-normal">(was {m.commits_yesterday ?? 0})</span></dd>
          </div>
          <div>
            <dt className="text-ink-faint uppercase tracking-wide text-[10px]">Files</dt>
            <dd className="font-medium text-ink mt-0.5">{(m.files_touched_today ?? []).length}</dd>
          </div>
        </dl>

        {/* Lines of code is a secondary, demoted signal — never a headline. */}
        <p className="mt-2 text-[10px] text-ink-faint">
          Lines <span className="text-green-600">+{m.lines_added_today ?? 0}</span> <span className="text-red-600">-{m.lines_removed_today ?? 0}</span>
        </p>
      </Link>

      <DevSignalsStrip
        prs={prs}
        cadence={cadence}
        githubHandle={report.developer_handle}
        primaryRepo={branches?.[0]?.repo_full_name}
      />

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
  prs,
  cadence,
}: {
  report: DevReportRow;
  todayStatus?: TodayDevStatus;
  branches?: ActiveBranchRow[];
  prs?: OpenPrRow[];
  cadence?: CadenceEntry;
}) {
  return (
    <article className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-5 mb-3 mx-3 shadow-sm relative">
      <Link
        href={`/dev/${report.developer_handle}`}
        className="block -m-5 mb-0 p-5 pb-0 rounded-t-xl active:opacity-80 transition"
        aria-label={`View ${report.display_name}'s timeline`}
      >
        <span aria-hidden className="absolute top-4 right-4 text-ink-faint text-sm">→</span>
        <header className="flex items-center gap-3 mb-3">
          <DevAvatar
            displayName={report.display_name}
            handle={report.developer_handle}
            size="md"
            trajectory="stuck"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-ink">{report.display_name}</h2>
              {todayStatus && <TodayStatusPill status={todayStatus} />}
            </div>
            <p className="text-xs text-ink-faint">@{report.developer_handle}</p>
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
      <DevSignalsStrip
        prs={prs}
        cadence={cadence}
        githubHandle={report.developer_handle}
        primaryRepo={branches?.[0]?.repo_full_name}
      />
      {branches && <DevBranchList branches={branches} />}
    </article>
  );
}

function ExpandedSection({ report }: { report: DevReportRow }) {
  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className="text-ink-faint mt-2">Generator version: {report.generator_version}</p>
    </div>
  );
}
