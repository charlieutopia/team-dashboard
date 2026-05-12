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
}

export interface DevTimelineResult {
  developer: { id: string; github_handle: string; display_name: string };
  days: DevTimelineDay[];
  totals: DevTimelineTotals;
  windowDays: number;
  klToday: string;
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

  // 2. Build the date window: newest-first [klToday, klToday-1, ..., klToday-(windowDays-1)]
  const dateList: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    dateList.push(shiftKlDate(klToday, -i));
  }
  const oldestDate = dateList[dateList.length - 1]!;
  const newestDate = dateList[0]!;

  // 3. Fetch reports in window for this developer
  const { data: reports, error: repErr } = await supabase
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
    .lte('report_date', newestDate);

  if (repErr) throw repErr;

  // 4. Index reports by date
  const reportMap = new Map<string, any>();
  (reports ?? []).forEach((r: any) => {
    reportMap.set(r.report_date, r);
  });

  // 5. Left-join: build days array in newest-first order, fill empties
  const days: DevTimelineDay[] = dateList.map(date => {
    const r = reportMap.get(date);
    if (!r) {
      return {
        report_date: date,
        summary: null,
        metrics: null,
        spec_progress: null,
        trajectory: null,
        parse_failed: false,
        error_msg: null,
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
    };
  });

  // 6. Aggregate totals over days WITH data
  const filesSet = new Set<string>();
  let totalCommits = 0;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  let totalAdvancing = 0;
  let totalDrifting = 0;
  let onTrackDays = 0;
  let failedDays = 0;
  let daysWithData = 0;

  for (const day of days) {
    const hasData = day.parse_failed || day.summary !== null || day.metrics !== null || day.trajectory !== null;
    if (!hasData) continue;
    daysWithData++;
    if (day.parse_failed) {
      failedDays++;
      continue; // metrics not trustworthy on failed days
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
  };

  return { developer, days, totals, windowDays, klToday };
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
