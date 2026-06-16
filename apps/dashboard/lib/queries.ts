import type { SupabaseClient } from '@supabase/supabase-js';

export type DevLevel = 'intern' | 'junior' | 'senior' | 'freelancer';

export interface DevReportRow {
  developer_id: string;
  developer_handle: string;
  display_name: string;
  level: DevLevel | null;
  /** YYYY-MM-DD when this person's engagement ends, or null if open-ended. */
  end_date: string | null;
  report_date: string;
  summary: string | null;
  metrics: any;
  spec_progress: any;
  trajectory: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity' | null;
  generator_version: string | null;
  parse_failed: boolean;
  error_msg: string | null;
  drift_count: number;
}

export interface LatestReportsResult {
  /** The report_date being shown — the most recent date with any reports */
  reportDate: string | null;
  /** What KL date is today, for "is this stale?" comparison in the UI */
  klToday: string;
  rows: DevReportRow[];
}

const TRAJECTORY_ORDER: Record<string, number> = {
  stuck: 0,
  behind: 1,
  no_activity: 2,
  on_track: 3,
  ahead: 4,
};

function computeKlDate(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}

/**
 * Today's calendar date in Kuala Lumpur as a YYYY-MM-DD string.
 *
 * Shared helper so server actions (end-date handling) and the dashboard agree
 * on what "today" means without each re-deriving the KL offset.
 */
export function klTodayDate(now: Date = new Date()): string {
  return computeKlDate(now);
}

/**
 * ISO-8601 week number (1–53) for a KL calendar date string (YYYY-MM-DD).
 *
 * Pass the same `klToday` value the queries already compute so the week number
 * is anchored to Kuala Lumpur's "today", not the server's UTC day. ISO weeks
 * start on Monday and week 1 is the week containing the first Thursday of the
 * year (equivalently, the week containing January 4th).
 */
export function isoWeek(klDate: string): number {
  const [y, m, d] = klDate.split('-').map(Number) as [number, number, number];
  // Work in UTC to avoid local-timezone drift; the input is already KL-local.
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of the current ISO week (ISO weekday: Mon=1..Sun=7).
  const isoDay = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + 4 - isoDay);
  // First day of that ISO year.
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** How far back to look for each active dev's most-recent daily_report. A dev
 *  whose latest report is older than this drops off the home list entirely. */
const LATEST_REPORT_WINDOW_DAYS = 60;

export async function getLatestReports(supabase: SupabaseClient): Promise<LatestReportsResult> {
  const klToday = computeKlDate(new Date());

  // Show EACH active dev's most-recent daily_report, not one global latest
  // date. The scanner now skips devs with no recent activity, so on any given
  // day only some devs get a fresh row — keying on a single global latest date
  // made everyone else vanish. Instead fetch a wide window of recent reports
  // for active devs (newest-first) and keep the first row seen per developer.
  const oldestDate = shiftKlDate(klToday, -(LATEST_REPORT_WINDOW_DAYS - 1));

  const { data: reports, error } = await supabase
    .from('daily_reports')
    .select(`
      developer_id,
      report_date,
      summary,
      metrics,
      spec_progress,
      trajectory,
      generator_version,
      parse_failed,
      error_msg,
      developers!inner ( github_handle, display_name, active, level, end_date )
    `)
    .gte('report_date', oldestDate)
    // Inactive devs live only in /admin/team — never on the home list.
    .eq('developers.active', true)
    // Newest-first so the first row we keep per dev is their latest report.
    .order('report_date', { ascending: false });

  if (error) throw error;
  if (!reports || reports.length === 0) {
    return { reportDate: null, klToday, rows: [] };
  }

  // Keep the FIRST row seen per developer_id — that's their latest report.
  const latestByDev = new Map<string, any>();
  for (const r of reports as any[]) {
    if (!latestByDev.has(r.developer_id)) {
      latestByDev.set(r.developer_id, r);
    }
  }
  const latestReports = Array.from(latestByDev.values());

  // Drift counts per developer, each scoped to THAT dev's own latest date
  // (dates now vary per person, so a single global date filter won't work).
  const reportDatePairs = latestReports.map(
    (r: any) => `${r.developer_id}:${r.report_date}`,
  );
  const devIds = latestReports.map((r: any) => r.developer_id);
  const reportDates = Array.from(
    new Set(latestReports.map((r: any) => r.report_date)),
  );
  const { data: driftCounts } = await supabase
    .from('drift_findings')
    .select('developer_id, report_date')
    .in('developer_id', devIds)
    .in('report_date', reportDates)
    .eq('bucket', 'out_of_scope');

  const driftMap = new Map<string, number>();
  (driftCounts ?? []).forEach((d: any) => {
    const key = `${d.developer_id}:${d.report_date}`;
    // Only count drift on the date that matches this dev's latest report.
    if (!reportDatePairs.includes(key)) return;
    driftMap.set(d.developer_id, (driftMap.get(d.developer_id) ?? 0) + 1);
  });

  const rows: DevReportRow[] = latestReports.map((r: any) => ({
    developer_id: r.developer_id,
    developer_handle: r.developers.github_handle,
    display_name: r.developers.display_name,
    level: r.developers.level ?? null,
    end_date: r.developers.end_date ?? null,
    report_date: r.report_date,
    summary: r.summary,
    metrics: r.metrics,
    spec_progress: r.spec_progress,
    trajectory: r.trajectory,
    generator_version: r.generator_version,
    parse_failed: r.parse_failed ?? false,
    error_msg: r.error_msg ?? null,
    drift_count: driftMap.get(r.developer_id) ?? 0,
  }));

  // Sort: failures first (parse_failed), then worst trajectory
  rows.sort((a, b) => {
    if (a.parse_failed !== b.parse_failed) return a.parse_failed ? -1 : 1;
    const orderA = TRAJECTORY_ORDER[a.trajectory ?? 'no_activity'] ?? 2;
    const orderB = TRAJECTORY_ORDER[b.trajectory ?? 'no_activity'] ?? 2;
    return orderA - orderB;
  });

  // reportDate kept for back-compat on the result shape; with per-person dates
  // there's no single date, so report the newest one present across the team.
  const newestReportDate = rows.reduce<string | null>(
    (max, r) => (max === null || r.report_date > max ? r.report_date : max),
    null,
  );
  return { reportDate: newestReportDate, klToday, rows };
}

// Back-compat alias for any caller still importing the old name
export const getTodayReports = async (supabase: SupabaseClient): Promise<DevReportRow[]> => {
  const { rows } = await getLatestReports(supabase);
  return rows;
};

export interface DevTimelineDay {
  report_date: string;
  summary: string | null;
  metrics: any;
  spec_progress: any;
  trajectory: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity' | null;
  parse_failed: boolean;
  error_msg: string | null;
  // Phase 2 Step 2 additions — leave + PH awareness on each day:
  on_leave: boolean;
  leave_type: string | null;
  is_half_day_leave: boolean;
  is_public_holiday: boolean;
  holiday_name: string | null;
  is_weekend: boolean;
}

export interface DevTimelineTotals {
  total_days_with_data: number;
  on_track_days: number;
  failed_days: number;
  total_commits: number;
  total_lines_added: number;
  total_lines_removed: number;
  unique_files_touched: number;
  total_advancing: number;
  total_drifting: number;
  // Phase 2 Step 2 KPI fields:
  working_days_in_window: number; // calendar - weekends - public_holidays
  on_leave_days: number; // full + half (half-day = 0.5)
  should_have_worked: number; // working_days_in_window - on_leave_days
  days_shipped: number; // days with commits_today > 0 (excludes parse_failed)
  stuck_days: number; // should_have_worked - days_shipped
  ship_pct: number; // days_shipped / should_have_worked * 100, 0 when no should
}

export interface DevTimelineResult {
  developer: {
    id: string;
    github_handle: string;
    display_name: string;
    active: boolean;
    end_date: string | null;
    level: DevLevel | null;
    tenure_note: string | null;
    owned_systems: string[];
  };
  days: DevTimelineDay[];
  totals: DevTimelineTotals;
  windowDays: number; // requested window (e.g. 30)
  effectiveWindowDays: number; // actual length after clamping to data-range floor
  isWindowClamped: boolean; // true when effectiveWindowDays < windowDays
  klToday: string;
  earliestDailyReport: string | null; // floor used by the clamp; null if dev has zero daily reports
}

function shiftKlDate(klToday: string, deltaDays: number): string {
  // klToday is YYYY-MM-DD. Shift by deltaDays (negative = past).
  const [y, m, d] = klToday.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().split('T')[0]!;
}

export async function getDevTimeline(
  supabase: SupabaseClient,
  githubHandle: string,
  windowDays: number = 30,
): Promise<DevTimelineResult | null> {
  const klToday = computeKlDate(new Date());

  // 1. Find the developer. Inactive devs are hidden from the home + week lists
  //    but their detail page still renders (history look-back) — the page shows
  //    an "inactive" banner above the timeline. Only a missing handle is
  //    not-found (the page calls notFound() on a null result).
  const { data: devRow, error: devErr } = await supabase
    .from('developers')
    .select('id, github_handle, display_name, active, end_date, level, tenure_note, owned_systems')
    .eq('github_handle', githubHandle)
    .maybeSingle();

  if (devErr) throw devErr;
  if (!devRow) return null;

  const developerRaw = devRow as {
    id: string;
    github_handle: string;
    display_name: string;
    active: boolean;
    end_date: string | null;
    level: DevLevel | null;
    tenure_note: string | null;
    owned_systems: string[] | null;
  };

  const developer = {
    id: developerRaw.id,
    github_handle: developerRaw.github_handle,
    display_name: developerRaw.display_name,
    active: developerRaw.active,
    end_date: developerRaw.end_date ?? null,
    level: developerRaw.level ?? null,
    tenure_note: developerRaw.tenure_note ?? null,
    owned_systems: developerRaw.owned_systems ?? [],
  };

  // 2a. Find the earliest daily_report date for this dev — used to clamp the
  //     window so KPIs aren't computed against a "should have worked" range
  //     that predates the daily-report system. Without this, devs with only
  //     a few days of reports show absurd "Worked 2 of 20 days" headlines.
  const { data: earliestRow } = await supabase
    .from('daily_reports')
    .select('report_date')
    .eq('developer_id', developer.id)
    .order('report_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  const earliestDailyReport =
    (earliestRow as { report_date: string } | null)?.report_date ?? null;

  // 2b. Build the date window: newest-first. Clamp the start to whichever is
  //     LATER: (klToday - windowDays + 1) or the earliest daily_report date.
  //     If the dev has zero daily reports, fall back to the requested window
  //     (the KPI strip will surface "no data" naturally).
  const requestedOldest = shiftKlDate(klToday, -(windowDays - 1));
  const effectiveOldest =
    earliestDailyReport && earliestDailyReport > requestedOldest
      ? earliestDailyReport
      : requestedOldest;

  const dateList: string[] = [];
  let cursor = klToday;
  while (cursor >= effectiveOldest) {
    dateList.push(cursor);
    cursor = shiftKlDate(cursor, -1);
  }
  const effectiveWindowDays = dateList.length;
  const isWindowClamped = effectiveWindowDays < windowDays;
  const oldestDate = dateList[dateList.length - 1]!;
  const newestDate = dateList[0]!;

  // 3. Fetch reports + leave_days + public_holidays in window (3 parallel queries)
  const [reportsRes, leavesRes, holidaysRes] = await Promise.all([
    supabase
      .from('daily_reports')
      .select(`
        report_date,
        summary,
        metrics,
        spec_progress,
        trajectory,
        parse_failed,
        error_msg
      `)
      .eq('developer_id', developer.id)
      .gte('report_date', oldestDate)
      .lte('report_date', newestDate),
    supabase
      .from('developer_leave_days')
      .select('leave_date, leave_type, is_half_day, half_segment')
      .eq('developer_id', developer.id)
      .gte('leave_date', oldestDate)
      .lte('leave_date', newestDate),
    supabase
      .from('public_holidays')
      .select('holiday_date, name')
      .eq('state', 'KL')
      .gte('holiday_date', oldestDate)
      .lte('holiday_date', newestDate),
  ]);

  if (reportsRes.error) throw reportsRes.error;
  if (leavesRes.error) throw leavesRes.error;
  if (holidaysRes.error) throw holidaysRes.error;

  // 4. Index by date
  const reportMap = new Map<string, any>();
  (reportsRes.data ?? []).forEach((r: any) => {
    reportMap.set(r.report_date, r);
  });
  const leaveMap = new Map<string, { leave_type: string; is_half_day: boolean }>();
  (leavesRes.data ?? []).forEach((l: any) => {
    leaveMap.set(l.leave_date, {
      leave_type: l.leave_type,
      is_half_day: l.is_half_day,
    });
  });
  // Multiple holidays can share a date (e.g. Thaipusam + Federal Territory Day on 2026-02-01)
  // — keep the first one we see; the dashboard tooltip shows that name.
  const holidayMap = new Map<string, string>();
  (holidaysRes.data ?? []).forEach((h: any) => {
    if (!holidayMap.has(h.holiday_date)) {
      holidayMap.set(h.holiday_date, h.name);
    }
  });

  // 5. Left-join: build days array in newest-first order, fill empties
  const days: DevTimelineDay[] = dateList.map(date => {
    const r = reportMap.get(date);
    const leave = leaveMap.get(date);
    const holidayName = holidayMap.get(date) ?? null;
    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const base = {
      on_leave: !!leave,
      leave_type: leave?.leave_type ?? null,
      is_half_day_leave: leave?.is_half_day ?? false,
      is_public_holiday: !!holidayName,
      holiday_name: holidayName,
      is_weekend: isWeekend,
    };
    if (!r) {
      return {
        report_date: date,
        summary: null,
        metrics: null,
        spec_progress: null,
        trajectory: null,
        parse_failed: false,
        error_msg: null,
        ...base,
      };
    }
    return {
      report_date: r.report_date,
      summary: r.summary ?? null,
      metrics: r.metrics ?? null,
      spec_progress: r.spec_progress ?? null,
      trajectory: r.trajectory ?? null,
      parse_failed: r.parse_failed ?? false,
      error_msg: r.error_msg ?? null,
      ...base,
    };
  });

  // 6. Aggregate totals over days WITH data + Phase 2 KPI computation
  const filesSet = new Set<string>();
  let totalCommits = 0;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  let totalAdvancing = 0;
  let totalDrifting = 0;
  let onTrackDays = 0;
  let failedDays = 0;
  let daysWithData = 0;

  // Phase 2 KPI accumulators
  let workingDaysInWindow = 0;
  let onLeaveDaysAccum = 0; // sum of 1.0 / 0.5 contributions
  let daysShipped = 0;

  for (const day of days) {
    // KPI math — works on every day, not just days with daily_reports
    if (!day.is_weekend && !day.is_public_holiday) {
      workingDaysInWindow += 1;
    }
    if (day.on_leave) {
      onLeaveDaysAccum += day.is_half_day_leave ? 0.5 : 1;
    }
    if (
      !day.parse_failed &&
      day.metrics &&
      Number((day.metrics as any).commits_today ?? 0) > 0
    ) {
      daysShipped += 1;
    }

    // Existing totals (only days WITH data)
    const hasData = day.parse_failed || day.summary !== null || day.metrics !== null || day.trajectory !== null;
    if (!hasData) continue;
    daysWithData++;
    if (day.parse_failed) {
      failedDays++;
      continue;
    }
    if (day.trajectory === 'on_track' || day.trajectory === 'ahead') onTrackDays++;
    const m = day.metrics ?? {};
    totalCommits += Number(m.commits_today ?? 0);
    totalLinesAdded += Number(m.lines_added_today ?? 0);
    totalLinesRemoved += Number(m.lines_removed_today ?? 0);
    const files: unknown = m.files_touched_today;
    if (Array.isArray(files)) {
      for (const f of files) {
        if (typeof f === 'string') filesSet.add(f);
      }
    }
    const sp = day.spec_progress ?? {};
    if (Array.isArray(sp.advancing)) totalAdvancing += sp.advancing.length;
    if (Array.isArray(sp.drifting)) totalDrifting += sp.drifting.length;
  }

  const shouldHaveWorked = Math.max(0, workingDaysInWindow - onLeaveDaysAccum);
  const stuckDays = Math.max(0, shouldHaveWorked - daysShipped);
  const shipPct =
    shouldHaveWorked > 0
      ? Math.round((daysShipped / shouldHaveWorked) * 100)
      : 0;

  const totals: DevTimelineTotals = {
    total_days_with_data: daysWithData,
    on_track_days: onTrackDays,
    failed_days: failedDays,
    total_commits: totalCommits,
    total_lines_added: totalLinesAdded,
    total_lines_removed: totalLinesRemoved,
    unique_files_touched: filesSet.size,
    total_advancing: totalAdvancing,
    total_drifting: totalDrifting,
    working_days_in_window: workingDaysInWindow,
    on_leave_days: onLeaveDaysAccum,
    should_have_worked: shouldHaveWorked,
    days_shipped: daysShipped,
    stuck_days: stuckDays,
    ship_pct: shipPct,
  };

  return {
    developer,
    days,
    totals,
    windowDays,
    effectiveWindowDays,
    isWindowClamped,
    klToday,
    earliestDailyReport,
  };
}

// ---- Weekly digests (Layer B) ----

export type Momentum =
  | 'accelerating'
  | 'steady'
  | 'slowing'
  | 'stalled'
  | 'no_activity';

export interface WeeklyDigestRow {
  developer_id: string;
  developer_handle: string;
  display_name: string;
  /** Seniority level for the card's LevelChip. Null when the source query
   *  doesn't fetch it (e.g. the per-dev digest on /dev/[handle]). */
  level: DevLevel | null;
  week_start_date: string;
  summary: string | null;
  momentum: Momentum | null;
  top_themes: string[] | null;
  generator_version: string | null;
  parse_failed: boolean;
  error_msg: string | null;
}

const MOMENTUM_ORDER: Record<string, number> = {
  accelerating: 0,
  steady: 1,
  slowing: 2,
  stalled: 3,
  no_activity: 4,
};

export async function getDevWeeklyDigest(
  supabase: SupabaseClient,
  githubHandle: string,
): Promise<WeeklyDigestRow | null> {
  const { data: devRow } = await supabase
    .from('developers')
    .select('id, github_handle, display_name')
    .eq('github_handle', githubHandle)
    .maybeSingle();

  if (!devRow) return null;
  const developer = devRow as { id: string; github_handle: string; display_name: string };

  const { data, error } = await supabase
    .from('weekly_reports')
    .select(
      'week_start_date, summary, momentum, top_themes, generator_version, parse_failed, error_msg',
    )
    .eq('developer_id', developer.id)
    .order('week_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Omit<
    WeeklyDigestRow,
    'developer_id' | 'developer_handle' | 'display_name' | 'level'
  >;
  return {
    developer_id: developer.id,
    developer_handle: developer.github_handle,
    display_name: developer.display_name,
    // This per-dev query doesn't fetch level; the card renders no LevelChip.
    level: null,
    week_start_date: row.week_start_date,
    summary: row.summary,
    momentum: row.momentum,
    top_themes: row.top_themes,
    generator_version: row.generator_version,
    parse_failed: row.parse_failed,
    error_msg: row.error_msg,
  };
}

/**
 * Shift a Monday week_start_date (YYYY-MM-DD) by N weeks. The stored value is
 * already a KL Monday, so plain UTC date math keeps it on a Monday without
 * any timezone day-drift (mirrors the shiftKlDate helper above).
 */
export function shiftWeekStart(weekStartDate: string, deltaWeeks: number): string {
  return shiftKlDate(weekStartDate, deltaWeeks * 7);
}

/**
 * The most-recent week_start_date that has any weekly_reports rows, or null
 * when none exist. Used by the /week nav to know whether "Next week" should be
 * enabled (you can't browse forward past the latest available week).
 */
export async function getLatestWeekStartDate(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('weekly_reports')
    .select('week_start_date')
    .order('week_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { week_start_date: string } | null)?.week_start_date ?? null;
}

export interface AllWeeklyDigestsResult {
  weekStartDate: string | null;
  rows: WeeklyDigestRow[];
}

export async function getAllWeeklyDigests(
  supabase: SupabaseClient,
  weekStartDate?: string,
): Promise<AllWeeklyDigestsResult> {
  // Default to the most-recent week that has any rows (the prior behavior).
  // An explicit weekStartDate (a KL Monday) lets the page browse past weeks.
  const targetWeek = weekStartDate ?? (await getLatestWeekStartDate(supabase));
  if (!targetWeek) return { weekStartDate: null, rows: [] };

  const { data, error } = await supabase
    .from('weekly_reports')
    .select(
      `developer_id, week_start_date, summary, momentum, top_themes, generator_version, parse_failed, error_msg, developers!inner ( github_handle, display_name, active, level )`,
    )
    .eq('week_start_date', targetWeek)
    // Inactive devs live only in /admin/team — never on the weekly surface.
    .eq('developers.active', true);

  if (error) throw error;

  const rows: WeeklyDigestRow[] = (data ?? []).map((r: any) => ({
    developer_id: r.developer_id,
    developer_handle: r.developers.github_handle,
    display_name: r.developers.display_name,
    level: r.developers.level ?? null,
    week_start_date: r.week_start_date,
    summary: r.summary,
    momentum: r.momentum,
    top_themes: r.top_themes,
    generator_version: r.generator_version,
    parse_failed: r.parse_failed ?? false,
    error_msg: r.error_msg,
  }));

  // Sort: failures first, then by momentum (accelerating → no_activity)
  rows.sort((a, b) => {
    if (a.parse_failed !== b.parse_failed) return a.parse_failed ? -1 : 1;
    const oA = MOMENTUM_ORDER[a.momentum ?? 'no_activity'] ?? 4;
    const oB = MOMENTUM_ORDER[b.momentum ?? 'no_activity'] ?? 4;
    return oA - oB;
  });

  // Return targetWeek (not the input) so an explicitly-requested week with no
  // rows still reports its date — the page renders the header + nav + empty
  // state for that week so the viewer can navigate away.
  return { weekStartDate: targetWeek, rows };
}

// ---- Monthly digests (Phase 2 Step 3) ----

export interface MonthlyDigestRow {
  developer_id: string;
  developer_handle: string;
  display_name: string;
  month_start_date: string;
  summary: string | null;
  momentum: Momentum | null;
  top_themes: string[] | null;
  generator_version: string | null;
  parse_failed: boolean;
  error_msg: string | null;
}

export async function getDevMonthlyDigest(
  supabase: SupabaseClient,
  githubHandle: string,
): Promise<MonthlyDigestRow | null> {
  const { data: devRow } = await supabase
    .from('developers')
    .select('id, github_handle, display_name')
    .eq('github_handle', githubHandle)
    .maybeSingle();
  if (!devRow) return null;
  const developer = devRow as { id: string; github_handle: string; display_name: string };

  const { data, error } = await supabase
    .from('monthly_reports')
    .select(
      'month_start_date, summary, momentum, top_themes, generator_version, parse_failed, error_msg',
    )
    .eq('developer_id', developer.id)
    .order('month_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as Omit<MonthlyDigestRow, 'developer_id' | 'developer_handle' | 'display_name'>;
  return {
    developer_id: developer.id,
    developer_handle: developer.github_handle,
    display_name: developer.display_name,
    month_start_date: row.month_start_date,
    summary: row.summary,
    momentum: row.momentum,
    top_themes: row.top_themes,
    generator_version: row.generator_version,
    parse_failed: row.parse_failed,
    error_msg: row.error_msg,
  };
}

// ---- Today status (Phase 3 Step 1) ----

export type TodayStatus =
  | 'working'
  | 'on_leave'
  | 'half_day_leave'
  | 'public_holiday'
  | 'weekend'
  | 'inactive';

export interface TodayDevStatus {
  developer_id: string;
  github_handle: string;
  display_name: string;
  status: TodayStatus;
  leaveType: string | null;
  isHalfDay: boolean;
  halfSegment: string | null;
  holidayName: string | null;
}

export interface TodayStatusResult {
  klToday: string;
  isWeekend: boolean;
  isPublicHoliday: boolean;
  holidayName: string | null;
  /** keyed by developer_id; ACTIVE devs only */
  perDev: Record<string, TodayDevStatus>;
  /** keyed by github_handle; convenience for DevList lookup */
  perHandle: Record<string, TodayDevStatus>;
  counts: {
    working: number;
    onLeave: number;
    halfDay: number;
    publicHoliday: number;
    weekend: number;
    totalActive: number;
  };
  /** Active devs whose status !== 'working' — for the header's off-today list */
  offTodayList: TodayDevStatus[];
}

export async function getTodayStatus(
  supabase: SupabaseClient,
): Promise<TodayStatusResult> {
  const klToday = computeKlDate(new Date());
  const dayOfWeek = new Date(klToday + 'T00:00:00Z').getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // 3 parallel queries — devs + today's leave + today's holiday
  const [devsRes, leavesRes, holidaysRes] = await Promise.all([
    supabase
      .from('developers')
      .select('id, github_handle, display_name, active'),
    supabase
      .from('developer_leave_days')
      .select('developer_id, leave_type, is_half_day, half_segment')
      .eq('leave_date', klToday),
    supabase
      .from('public_holidays')
      .select('name')
      .eq('state', 'KL')
      .eq('holiday_date', klToday),
  ]);

  if (devsRes.error) throw devsRes.error;
  if (leavesRes.error) throw leavesRes.error;
  if (holidaysRes.error) throw holidaysRes.error;

  const allDevs = (devsRes.data ?? []) as {
    id: string;
    github_handle: string;
    display_name: string;
    active: boolean;
  }[];
  const leaveByDevId = new Map<
    string,
    { leave_type: string; is_half_day: boolean; half_segment: string | null }
  >();
  for (const l of (leavesRes.data ?? []) as {
    developer_id: string;
    leave_type: string;
    is_half_day: boolean;
    half_segment: string | null;
  }[]) {
    leaveByDevId.set(l.developer_id, {
      leave_type: l.leave_type,
      is_half_day: l.is_half_day,
      half_segment: l.half_segment,
    });
  }
  const holidayRows = (holidaysRes.data ?? []) as { name: string }[];
  const isPublicHoliday = holidayRows.length > 0;
  const holidayName = isPublicHoliday ? holidayRows[0]!.name : null;

  const perDev: Record<string, TodayDevStatus> = {};
  const perHandle: Record<string, TodayDevStatus> = {};
  const counts = {
    working: 0,
    onLeave: 0,
    halfDay: 0,
    publicHoliday: 0,
    weekend: 0,
    totalActive: 0,
  };

  for (const dev of allDevs) {
    // Inactive devs never appear on any main surface — they live only in
    // /admin/team. Skip them here so no inactive count, pill, or perDev/
    // perHandle entry leaks onto the home header or dev list.
    if (!dev.active) {
      continue;
    }
    counts.totalActive += 1;

    let status: TodayStatus;
    let leaveType: string | null = null;
    let isHalfDay = false;
    let halfSegment: string | null = null;
    let devHolidayName: string | null = null;

    // Precedence: weekend > public_holiday > leave > working
    if (isWeekend) {
      status = 'weekend';
      counts.weekend += 1;
    } else if (isPublicHoliday) {
      status = 'public_holiday';
      devHolidayName = holidayName;
      counts.publicHoliday += 1;
    } else {
      const leave = leaveByDevId.get(dev.id);
      if (leave) {
        if (leave.is_half_day) {
          status = 'half_day_leave';
          counts.halfDay += 1;
        } else {
          status = 'on_leave';
          counts.onLeave += 1;
        }
        leaveType = leave.leave_type;
        isHalfDay = leave.is_half_day;
        halfSegment = leave.half_segment;
      } else {
        status = 'working';
        counts.working += 1;
      }
    }

    const entry: TodayDevStatus = {
      developer_id: dev.id,
      github_handle: dev.github_handle,
      display_name: dev.display_name,
      status,
      leaveType,
      isHalfDay,
      halfSegment,
      holidayName: devHolidayName,
    };
    perDev[dev.id] = entry;
    perHandle[dev.github_handle] = entry;
  }

  // perDev holds active devs only, so any non-working status is genuinely
  // "off today" (on leave / half-day / public holiday / weekend).
  const offTodayList = Object.values(perDev)
    .filter(d => d.status !== 'working')
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return {
    klToday,
    isWeekend,
    isPublicHoliday,
    holidayName,
    perDev,
    perHandle,
    counts,
    offTodayList,
  };
}

// ---- Open PRs (Phase 3 Step 4) ----

export interface OpenPrRow {
  id: string;
  developer_id: string;
  repo_full_name: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  pr_state: 'open' | 'draft';
  pr_created_at: string | null;
  pr_updated_at: string | null;
  captured_at: string;
}

export async function getOpenPrsByDev(
  supabase: SupabaseClient,
): Promise<{
  byDev: Record<string, OpenPrRow[]>;
  populated: boolean;
}> {
  const [activeDevsRes, prsRes] = await Promise.all([
    supabase.from('developers').select('id').eq('active', true),
    supabase
      .from('developer_open_prs')
      .select(
        'id, developer_id, repo_full_name, pr_number, pr_title, pr_url, pr_state, pr_created_at, pr_updated_at, captured_at',
      )
      .order('pr_updated_at', { ascending: false, nullsFirst: false }),
  ]);

  if (activeDevsRes.error) throw activeDevsRes.error;
  if (prsRes.error) throw prsRes.error;

  const byDev: Record<string, OpenPrRow[]> = {};
  for (const row of (activeDevsRes.data ?? []) as { id: string }[]) {
    byDev[row.id] = [];
  }
  for (const row of (prsRes.data ?? []) as OpenPrRow[]) {
    const existing = byDev[row.developer_id];
    if (existing) {
      existing.push(row);
    } else {
      byDev[row.developer_id] = [row];
    }
  }
  return { byDev, populated: (prsRes.data ?? []).length > 0 };
}

// ---- Cadence (Phase 3 Step 4) ----

export interface CadenceEntry {
  thisWeek: number;
  lastWeek: number;
  deltaPct: number; // -100 .. +∞; 0 when both weeks empty
  direction: 'up' | 'flat' | 'down' | 'no_data';
  /** Last 7 days commits per dev, oldest-first (length always 7, missing days = 0). */
  daily: number[];
}

export async function getCadenceByDev(
  supabase: SupabaseClient,
): Promise<Record<string, CadenceEntry>> {
  const klToday = computeKlDate(new Date());
  const oldestDay = shiftKlDate(klToday, -13); // last 14 days inclusive
  const thisWeekStart = shiftKlDate(klToday, -6); // last 7 days inclusive

  // Build the 7-day date grid (oldest → newest) so we can pad missing days.
  const thisWeekDates: string[] = [];
  for (let i = 6; i >= 0; i--) thisWeekDates.push(shiftKlDate(klToday, -i));
  const dateIndex = new Map(thisWeekDates.map((d, i) => [d, i]));

  const { data, error } = await supabase
    .from('daily_reports')
    .select('developer_id, report_date, metrics')
    .gte('report_date', oldestDay)
    .lte('report_date', klToday);
  if (error) throw error;

  const accum = new Map<
    string,
    { thisWeek: number; lastWeek: number; daily: number[] }
  >();
  for (const row of (data ?? []) as {
    developer_id: string;
    report_date: string;
    metrics: { commits_today?: number } | null;
  }[]) {
    const commits = Number(row.metrics?.commits_today ?? 0);
    const bucket = row.report_date >= thisWeekStart ? 'thisWeek' : 'lastWeek';
    const existing =
      accum.get(row.developer_id) ?? { thisWeek: 0, lastWeek: 0, daily: Array(7).fill(0) };
    existing[bucket] += commits;
    const dayIdx = dateIndex.get(row.report_date);
    if (dayIdx !== undefined) existing.daily[dayIdx] = commits;
    accum.set(row.developer_id, existing);
  }

  const out: Record<string, CadenceEntry> = {};
  for (const [devId, { thisWeek, lastWeek, daily }] of accum) {
    if (thisWeek === 0 && lastWeek === 0) {
      out[devId] = { thisWeek: 0, lastWeek: 0, deltaPct: 0, direction: 'no_data', daily };
      continue;
    }
    if (lastWeek === 0) {
      // Anything-vs-zero is unbounded; treat as up.
      out[devId] = { thisWeek, lastWeek: 0, deltaPct: 100, direction: 'up', daily };
      continue;
    }
    const deltaPct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
    let direction: CadenceEntry['direction'];
    if (deltaPct > 20) direction = 'up';
    else if (deltaPct < -20) direction = 'down';
    else direction = 'flat';
    out[devId] = { thisWeek, lastWeek, deltaPct, direction, daily };
  }
  return out;
}

// ---- Active branches (Phase 3 Step 3) ----

export interface ActiveBranchRow {
  id: string;
  developer_id: string;
  repo_full_name: string;
  branch_name: string;
  head_sha: string;
  base_sha: string;
  last_commit_at: string | null;
  last_commit_message: string | null;
  last_commit_author: string | null;
  commits_ahead: number;
  lines_added: number;
  lines_removed: number;
  files_changed: number;
  captured_at: string;
}

export async function getActiveBranchesByDev(
  supabase: SupabaseClient,
): Promise<{
  /** keyed by developer_id; entries exist for all active devs (empty array if no active branches) */
  byDev: Record<string, ActiveBranchRow[]>;
  /** true iff the developer_active_branches table has at least one row globally — used to decide whether to render the per-card branch section at all (pre-bootstrap suppresses it) */
  populated: boolean;
}> {
  const [activeDevsRes, branchesRes] = await Promise.all([
    supabase.from('developers').select('id').eq('active', true),
    supabase
      .from('developer_active_branches')
      .select(
        'id, developer_id, repo_full_name, branch_name, head_sha, base_sha, last_commit_at, last_commit_message, last_commit_author, commits_ahead, lines_added, lines_removed, files_changed, captured_at',
      )
      .order('last_commit_at', { ascending: false, nullsFirst: false }),
  ]);

  if (activeDevsRes.error) throw activeDevsRes.error;
  if (branchesRes.error) throw branchesRes.error;

  const byDev: Record<string, ActiveBranchRow[]> = {};
  for (const row of (activeDevsRes.data ?? []) as { id: string }[]) {
    byDev[row.id] = [];
  }
  for (const row of (branchesRes.data ?? []) as ActiveBranchRow[]) {
    const existing = byDev[row.developer_id];
    if (existing) {
      existing.push(row);
    } else {
      // Fallback for devs marked inactive after their branches were synced.
      byDev[row.developer_id] = [row];
    }
  }
  return { byDev, populated: (branchesRes.data ?? []).length > 0 };
}

export async function getDriftFindings(supabase: SupabaseClient, developerId: string, reportDate: string) {
  const { data, error } = await supabase
    .from('drift_findings')
    .select('*')
    .eq('developer_id', developerId)
    .eq('report_date', reportDate)
    .order('bucket');
  if (error) throw error;
  return data ?? [];
}

// ─── Phase 2 quality signals ────────────────────────────────────────────────

/**
 * The five-band scale one quality dimension can land on. Mirrors the
 * team_dashboard.quality_band enum. 'skipped' means the dimension had no
 * evidence this week (e.g. no code branches for test discipline) — distinct
 * from 'weak', which is a real low score.
 */
export type QualityBand = 'weak' | 'developing' | 'solid' | 'strong' | 'skipped';

/**
 * One developer's latest weekly quality scorecard. Each dimension carries a band
 * plus a short human-readable evidence string. Dimensions not yet computed are
 * null (this build ships Test Discipline first; the rest fill in later).
 */
export interface DevQualityRow {
  week_start_date: string;
  test_discipline_band: QualityBand | null;
  test_discipline_evidence: string | null;
  stability_band: QualityBand | null;
  stability_evidence: string | null;
  code_care_band: QualityBand | null;
  code_care_evidence: string | null;
  review_citizenship_band: QualityBand | null;
  review_citizenship_evidence: string | null;
  clarity_band: QualityBand | null;
  clarity_evidence: string | null;
  headline: string | null;
  needs_a_chat: boolean | null;
  level_snapshot: DevLevel | null;
}

/**
 * The most-recent weekly quality scorecard for one developer, or null when none
 * exists yet (the quality job hasn't run, or no week was computed for this dev).
 * Returning null is normal — the caller owns the empty state and must never
 * invent a band.
 */
export async function getDevQualityReport(
  supabase: SupabaseClient,
  githubHandle: string,
): Promise<DevQualityRow | null> {
  const { data: devRow } = await supabase
    .from('developers')
    .select('id')
    .eq('github_handle', githubHandle)
    .maybeSingle();
  if (!devRow) return null;
  const developerId = (devRow as { id: string }).id;

  const { data, error } = await supabase
    .from('weekly_quality_reports')
    .select(
      'week_start_date, test_discipline_band, test_discipline_evidence, stability_band, stability_evidence, code_care_band, code_care_evidence, review_citizenship_band, review_citizenship_evidence, clarity_band, clarity_evidence, headline, needs_a_chat, level_snapshot',
    )
    .eq('developer_id', developerId)
    .order('week_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as DevQualityRow;
}
