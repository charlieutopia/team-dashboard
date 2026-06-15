import Link from 'next/link';
import { DevAvatar } from './DevAvatar';
import { TodayStatusPill } from './TodayStatusPill';
import { currentBranchLine } from './DevBranchList';
import { LevelChip } from './LevelChip';
import type {
  ActiveBranchRow,
  CadenceEntry,
  DevReportRow,
  TodayDevStatus,
} from '@/lib/queries';

/** "Mon 9" style short date from a YYYY-MM-DD string (UTC, no day drift). */
function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} ${d}`;
}

/** Plain-English "vs last week" indicator from the cadence direction. */
function cadenceWord(c?: CadenceEntry): { arrow: string; text: string; cls: string } | null {
  if (!c || c.direction === 'no_data') return null;
  if (c.direction === 'up') {
    return { arrow: '↑', text: 'more than last week', cls: 'text-green-600' };
  }
  if (c.direction === 'down') {
    return { arrow: '↓', text: 'less than last week', cls: 'text-amber-600' };
  }
  return { arrow: '≈', text: 'same as last week', cls: 'text-ink-faint' };
}

function CardMetrics({
  report,
  cadence,
}: {
  report: DevReportRow;
  cadence?: CadenceEntry;
}) {
  const m = report.metrics ?? {};
  const commits = m.commits_today ?? 0;
  const files = (m.files_touched_today ?? []).length;
  const cadenceInfo = cadenceWord(cadence);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
      <span className="font-medium text-ink">
        {commits} commit{commits === 1 ? '' : 's'} · {files} file{files === 1 ? '' : 's'}
      </span>
      {cadenceInfo && (
        <span className={`inline-flex items-center gap-1 ${cadenceInfo.cls}`}>
          <span aria-hidden>·</span>
          <span>
            {cadenceInfo.arrow} {cadenceInfo.text}
          </span>
        </span>
      )}
      <span className="text-ink-faint">· updated {shortDate(report.report_date)}</span>
    </div>
  );
}

export function DevCard({
  report,
  todayStatus,
  branches,
  cadence,
}: {
  report: DevReportRow;
  todayStatus?: TodayDevStatus;
  branches?: ActiveBranchRow[];
  cadence?: CadenceEntry;
}) {
  if (report.parse_failed) {
    return <FailedCard report={report} todayStatus={todayStatus} branches={branches} />;
  }

  const m = report.metrics ?? {};
  const drillHref = `/dev/${report.developer_handle}`;
  // One compact line: the freshest active branch. Full list lives on the
  // person page. Renders nothing when there is no active branch.
  const branchLine = branches ? currentBranchLine(branches) : null;

  return (
    <Link
      href={drillHref}
      aria-label={`View ${report.display_name}'s timeline`}
      className="group block h-full rounded-2xl border border-line bg-card p-5 shadow-sm relative transition hover:border-line-strong active:opacity-80"
    >
      <span aria-hidden className="absolute top-5 right-5 text-ink-faint text-sm">→</span>

      {/* Row 1 — identity + status */}
      <header className="flex items-center gap-3">
        <DevAvatar
          displayName={report.display_name}
          handle={report.developer_handle}
          size="md"
          trajectory={report.trajectory}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[17px] font-bold leading-tight tracking-tight text-ink">
              {report.display_name}
            </h2>
            <span className="text-[13px] font-medium text-ink-faint">@{report.developer_handle}</span>
            <LevelChip level={report.level} />
            {todayStatus && <TodayStatusPill status={todayStatus} />}
          </div>
        </div>
      </header>

      {/* Row 2 — the hero: plain-English summary */}
      <p className="mt-3 text-[15px] leading-relaxed text-ink line-clamp-2">
        {report.summary}
      </p>

      {/* Row 3 — metrics + vs-last-week + freshness */}
      <CardMetrics report={report} cadence={cadence} />

      {/* One compact line: what they're working on now. */}
      {branchLine && (
        <p className="mt-1.5 text-[12px] text-ink-faint truncate">{branchLine}</p>
      )}

      {/* Lines of code — demoted to a whisper. */}
      <p className="mt-1 text-[10px] text-ink-faint">
        Lines <span className="text-green-600">+{m.lines_added_today ?? 0}</span>{' '}
        <span className="text-red-600">−{m.lines_removed_today ?? 0}</span>
      </p>
    </Link>
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
  const branchLine = branches ? currentBranchLine(branches) : null;
  return (
    <Link
      href={`/dev/${report.developer_handle}`}
      aria-label={`View ${report.display_name}'s timeline`}
      className="group block h-full rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-5 shadow-sm relative transition active:opacity-80"
    >
      <span aria-hidden className="absolute top-5 right-5 text-ink-faint text-sm">→</span>
      <header className="flex items-center gap-3">
        <DevAvatar
          displayName={report.display_name}
          handle={report.developer_handle}
          size="md"
          trajectory="stuck"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[17px] font-bold leading-tight tracking-tight text-ink">
              {report.display_name}
            </h2>
            <span className="text-[13px] font-medium text-ink-faint">@{report.developer_handle}</span>
            <LevelChip level={report.level} />
            {todayStatus && <TodayStatusPill status={todayStatus} />}
          </div>
        </div>
      </header>
      <p className="mt-3 text-[13px] text-red-700 dark:text-red-300">
        Couldn&apos;t build today&apos;s update.
      </p>
      {report.error_msg && (
        <p className="mt-1 text-xs font-mono text-red-600 dark:text-red-400 break-all">
          {report.error_msg}
        </p>
      )}
      {branchLine && (
        <p className="mt-1.5 text-[12px] text-ink-faint truncate">{branchLine}</p>
      )}
    </Link>
  );
}
