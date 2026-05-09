import type { SupabaseClient } from '@supabase/supabase-js';

export interface DevReportRow {
  developer_id: string;
  developer_handle: string;
  display_name: string;
  report_date: string;
  summary: string;
  metrics: any;
  spec_progress: any;
  trajectory: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity';
  generator_version: string;
  drift_count: number;
}

const TRAJECTORY_ORDER: Record<string, number> = {
  stuck: 0,
  behind: 1,
  no_activity: 2,
  on_track: 3,
  ahead: 4,
};

export async function getTodayReports(supabase: SupabaseClient): Promise<DevReportRow[]> {
  // KL date
  const klDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];

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
      developers!inner ( github_handle, display_name )
    `)
    .eq('report_date', klDate);

  if (error) throw error;
  if (!reports || reports.length === 0) return [];

  // Drift counts per developer per date
  const devIds = reports.map((r: any) => r.developer_id);
  const { data: driftCounts } = await supabase
    .from('drift_findings')
    .select('developer_id', { count: 'exact', head: false })
    .in('developer_id', devIds)
    .eq('report_date', klDate)
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
    drift_count: driftMap.get(r.developer_id) ?? 0,
  }));

  // Sort: worst trajectory first
  rows.sort((a, b) => {
    const orderA = TRAJECTORY_ORDER[a.trajectory] ?? 2;
    const orderB = TRAJECTORY_ORDER[b.trajectory] ?? 2;
    return orderA - orderB;
  });
  return rows;
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
