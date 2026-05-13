import type { SupabaseClient } from '@supabase/supabase-js';

export interface DevReportRow {
  developer_id: string;
  developer_handle: string;
  display_name: string;
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

export async function getLatestReports(supabase: SupabaseClient): Promise<LatestReportsResult> {
  const klToday = computeKlDate(new Date());

  // Find the latest report_date that has any rows. Falls back to most-recent
  // date if today's run hasn't fired yet (cron not deployed; local execution
  // pattern means morning runs may land before the Boss reads, but mid-day
  // checks may see yesterday's data until the next cron tick).
  const { data: latestDateRow, error: dateErr } = await supabase
    .from('daily_reports')
    .select('report_date')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dateErr) throw dateErr;

  const reportDate = (latestDateRow as { report_date: string } | null)?.report_date ?? null;
  if (!reportDate) {
    return { reportDate: null, klToday, rows: [] };
  }

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
      developers!inner ( github_handle, display_name )
    `)
    .eq('report_date', reportDate);

  if (error) throw error;
  if (!reports || reports.length === 0) {
    return { reportDate, klToday, rows: [] };
  }

  // Drift counts per developer for that date
  const devIds = reports.map((r: any) => r.developer_id);
  const { data: driftCounts } = await supabase
    .from('drift_findings')
    .select('developer_id', { count: 'exact', head: false })
    .in('developer_id', devIds)
    .eq('report_date', reportDate)
    .eq('bucket', 'out_of_scope');

  const driftMap = new Map<string, number>();
  (driftCounts ?? []).forEach((d: any) => {
    driftMap.set(d.developer_id, (driftMap.get(d.developer_id) ?? 0) + 1);
  });

  const rows: DevReportRow[] = reports.map((r: any) => ({
    developer_id: r.developer_id,
    developer_handle: r.developers.github_handle,
    display_name: r.developers.display_name,
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
  return { reportDate, klToday, rows };
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
  developer: { id: string; github_handle: string; display_name: string };
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

  // 1. Find the developer
  const { data: devRow, error: devErr } = await supabase
    .from('developers')
    .select('id, github_handle, display_name')
    .eq('github_handle', githubHandle)
    .maybeSingle();

  if (devErr) throw devErr;
  if (!devRow) return null;

  const developer = devRow as { id: string; github_handle: string; display_name: string };

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

  const row = data as Omit<WeeklyDigestRow, 'developer_id' | 'developer_handle' | 'display_name'>;
  return {
    developer_id: developer.id,
    developer_handle: developer.github_handle,
    display_name: developer.display_name,
    week_start_date: row.week_start_date,
    summary: row.summary,
    momentum: row.momentum,
    top_themes: row.top_themes,
    generator_version: row.generator_version,
    parse_failed: row.parse_failed,
    error_msg: row.error_msg,
  };
}

export interface AllWeeklyDigestsResult {
  weekStartDate: string | null;
  rows: WeeklyDigestRow[];
}

export async function getAllWeeklyDigests(
  supabase: SupabaseClient,
): Promise<AllWeeklyDigestsResult> {
  // Find most-recent week_start_date that has any rows
  const { data: latest, error: dateErr } = await supabase
    .from('weekly_reports')
    .select('week_start_date')
    .order('week_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dateErr) throw dateErr;
  const weekStartDate = (latest as { week_start_date: string } | null)?.week_start_date ?? null;
  if (!weekStartDate) return { weekStartDate: null, rows: [] };

  const { data, error } = await supabase
    .from('weekly_reports')
    .select(
      `developer_id, week_start_date, summary, momentum, top_themes, generator_version, parse_failed, error_msg, developers!inner ( github_handle, display_name )`,
    )
    .eq('week_start_date', weekStartDate);

  if (error) throw error;

  const rows: WeeklyDigestRow[] = (data ?? []).map((r: any) => ({
    developer_id: r.developer_id,
    developer_handle: r.developers.github_handle,
    display_name: r.developers.display_name,
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

  return { weekStartDate, rows };
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
    inactive: number;
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
    inactive: 0,
    totalActive: 0,
  };

  for (const dev of allDevs) {
    if (!dev.active) {
      counts.inactive += 1;
      const inactiveEntry: TodayDevStatus = {
        developer_id: dev.id,
        github_handle: dev.github_handle,
        display_name: dev.display_name,
        status: 'inactive',
        leaveType: null,
        isHalfDay: false,
        halfSegment: null,
        holidayName: null,
      };
      perDev[dev.id] = inactiveEntry;
      perHandle[dev.github_handle] = inactiveEntry;
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

  // off-today excludes inactive (they're not "off today" — they're off the team)
  const offTodayList = Object.values(perDev)
    .filter(d => d.status !== 'working' && d.status !== 'inactive')
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
