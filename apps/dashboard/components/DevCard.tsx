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
  return `${month} ${d}, ${y}`;
}

/** Today's KL date as YYYY-MM-DD — for the "ends soon" future-date check. */
function klTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date());
}

/** Whole days between two YYYY-MM-DD dates (UTC math, no day drift). */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
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

/** Commits + files counts. Lives in the identity block (LEFT). */
function CountsLine({ report }: { report: DevReportRow }) {
  const m = report.metrics ?? {};
  const commits = m.commits_today ?? 0;
  const files = (m.files_touched_today ?? []).length;
  return (
    <p className="mt-2 text-[13px] font-medium text-ink">
      {commits} commit{commits === 1 ? '' : 's'} · {files} file{files === 1 ? '' : 's'}
    </p>
  );
}

/** "vs last week" cadence word + freshness date. Lives under the analysis (RIGHT). */
function CadenceLine({
  report,
  cadence,
}: {
  report: DevReportRow;
  cadence?: CadenceEntry;
}) {
  const cadenceInfo = cadenceWord(cadence);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
      {cadenceInfo && (
        <span className={`inline-flex items-center gap-1 ${cadenceInfo.cls}`}>
          <span>
            {cadenceInfo.arrow} {cadenceInfo.text}
          </span>
        </span>
      )}
      <span className="text-ink-faint">
        {cadenceInfo ? '· ' : ''}updated {shortDate(report.report_date)}
      </span>
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
  // Show a muted "ends {Mon D}" hint for someone still active with a future
  // end date. Cards on the home list are active-only, so a future end_date
  // means they're winding down — the scanner flips them inactive once it
  // passes, at which point they drop off this list entirely.
  const endsSoon =
    report.end_date && report.end_date > klTodayStr() ? report.end_date : null;

  // Staleness hint: the home list now shows each person's MOST-RECENT report,
  // which may be older than today (the scanner skips quiet devs). When the
  // report isn't from today, surface "quiet {N}d" so Charlie can spot who's
  // gone quiet at a glance. No hint for a fresh (today's) report.
  const quietDays = daysBetween(report.report_date, klTodayStr());
  const quietHint = quietDays > 0 ? quietDays : null;

  return (
    <Link
      href={drillHref}
      aria-label={`View ${report.display_name}'s timeline`}
      className="group block rounded-2xl border border-line bg-card p-5 shadow-sm relative transition hover:border-line-strong active:opacity-80"
    >
      <span aria-hidden className="absolute top-5 right-5 text-ink-faint text-sm">→</span>

      <div className="flex flex-col sm:flex-row sm:gap-5">
        {/* LEFT — identity + metrics */}
        <div className="sm:w-56 sm:shrink-0">
          <header className="flex items-center gap-3">
            <DevAvatar
              displayName={report.display_name}
              handle={report.developer_handle}
              size="md"
              trajectory={report.trajectory}
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-[17px] font-bold leading-tight tracking-tight text-ink">
                {report.display_name}
              </h2>
              <span className="text-[13px] font-medium text-ink-faint">@{report.developer_handle}</span>
            </div>
          </header>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <LevelChip level={report.level} />
            {todayStatus && <TodayStatusPill status={todayStatus} />}
            {quietHint && (
              <span
                className="text-[11px] font-medium text-amber-600"
                title={`Latest report is from ${shortDate(report.report_date)}`}
              >
                quiet {quietHint}d
              </span>
            )}
            {endsSoon && (
              <span className="text-[11px] text-ink-faint">
                ends {shortDate(endsSoon)}
              </span>
            )}
          </div>

          {/* Commits + files counts. */}
          <CountsLine report={report} />

          {/* Lines of code — demoted to a whisper. */}
          <p className="mt-1 text-[10px] text-ink-faint">
            Lines <span className="text-green-600">+{m.lines_added_today ?? 0}</span>{' '}
            <span className="text-red-600">−{m.lines_removed_today ?? 0}</span>
          </p>
        </div>

        {/* RIGHT — the hero: FULL plain-English analysis, no truncation */}
        <div className="flex-1 min-w-0 mt-3 sm:mt-0 sm:pr-6">
          <p className="text-[15px] leading-relaxed text-ink whitespace-pre-line">
            {report.summary}
          </p>

          {/* vs-last-week + freshness */}
          <CadenceLine report={report} cadence={cadence} />

          {/* One compact line: what they're working on now. */}
          {branchLine && (
            <p className="mt-1.5 text-[12px] text-ink-faint truncate">{branchLine}</p>
          )}
        </div>
      </div>
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
      className="group block rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-5 shadow-sm relative transition active:opacity-80"
    >
      <span aria-hidden className="absolute top-5 right-5 text-ink-faint text-sm">→</span>

      <div className="flex flex-col sm:flex-row sm:gap-5">
        {/* LEFT — identity */}
        <div className="sm:w-56 sm:shrink-0">
          <header className="flex items-center gap-3">
            <DevAvatar
              displayName={report.display_name}
              handle={report.developer_handle}
              size="md"
              trajectory="stuck"
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-[17px] font-bold leading-tight tracking-tight text-ink">
                {report.display_name}
              </h2>
              <span className="text-[13px] font-medium text-ink-faint">@{report.developer_handle}</span>
            </div>
          </header>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <LevelChip level={report.level} />
            {todayStatus && <TodayStatusPill status={todayStatus} />}
          </div>
        </div>

        {/* RIGHT — the failure note */}
        <div className="flex-1 min-w-0 mt-3 sm:mt-0 sm:pr-6">
          <p className="text-[13px] text-red-700 dark:text-red-300">
            We couldn&apos;t build today&apos;s update for this person.
          </p>
          <p className="mt-1 text-[12px] text-ink-faint" title={report.error_msg ?? undefined}>
            It will try again automatically.
          </p>
          {branchLine && (
            <p className="mt-1.5 text-[12px] text-ink-faint truncate">{branchLine}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
