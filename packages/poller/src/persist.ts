import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedReport, ParsedDrift } from "./parse.js";

type TeamDashboardClient = SupabaseClient<any, "public", any, any, any>;

export async function persistReports(sb: TeamDashboardClient, reports: ParsedReport[]) {
  if (reports.length === 0) return;
  const rows = reports.map(r => ({
    developer_id: r.developer_id,
    report_date: r.date,
    summary: r.raw_summary,
    metrics: r.raw_metrics,
    spec_progress: r.raw_spec_progress,
    trajectory: r.raw_trajectory,
    generator_version: r.generator_version,
  }));
  const { error } = await sb.from("daily_reports").upsert(rows, { onConflict: "developer_id,report_date" });
  if (error) throw error;
}

export async function persistDrift(sb: TeamDashboardClient, drifts: ParsedDrift[]) {
  if (drifts.length === 0) return;

  // Build rows, but need to resolve developer_id from daily_reports for each drift
  const rows: any[] = [];
  for (const drift of drifts) {
    // Query daily_reports to find developer_id matching this repo + date
    // We assume there's exactly one report per (repo, date) pair per developer (from the scanner logic)
    const { data: reports } = await sb
      .from("daily_reports")
      .select("developer_id")
      .eq("report_date", drift.date)
      .limit(1);

    let developerId: string | null = null;
    if (reports && reports.length > 0 && reports[0]) {
      developerId = reports[0].developer_id;
    }

    if (!developerId) {
      console.warn(
        `Could not resolve developer_id for drift on ${drift.date} (repo: ${drift.repo_id}, branch: ${drift.branch}) — skipping drift findings`,
      );
      continue;
    }

    for (const finding of drift.findings) {
      rows.push({
        developer_id: developerId,
        report_date: drift.date,
        spec_item_path: finding.spec_item_path,
        bucket: finding.bucket,
        file_path: finding.file_path || null,
        line_range: finding.line_range ? `[${finding.line_range[0]},${finding.line_range[1]}]` : null,
        evidence: finding.evidence,
        detector_version: drift.detector_version,
      });
    }
  }

  if (rows.length === 0) return;
  const { error } = await sb.from("drift_findings").insert(rows);
  if (error) throw error;
}
