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
