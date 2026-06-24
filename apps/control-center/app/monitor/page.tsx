import { ShellHeader } from '@/components/ShellHeader';
import { StateDot } from '@/components/StateDot';
import { loadJobStatus } from '@/lib/data';
import { fmtTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const LEGEND: Array<{ dot: string; label: string }> = [
  { dot: 'bg-state-ok', label: 'Healthy' },
  { dot: 'bg-state-fail', label: 'Failed' },
  { dot: 'bg-state-disabled', label: 'Disabled' },
  { dot: 'bg-state-scheduled', label: 'Scheduled (health not checked)' },
];

export default async function JobMonitorPage() {
  let data;
  try {
    data = await loadJobStatus();
  } catch (err) {
    return (
      <main className="min-h-screen pb-12">
        <ShellHeader active="monitor" />
        <div className="mx-auto max-w-5xl px-5 pt-8">
          <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-state-fail">
            Could not load status.json — {(err as Error).message}.
          </p>
        </div>
      </main>
    );
  }

  const c = data.counts || {};

  return (
    <main className="min-h-screen pb-12">
      <ShellHeader active="monitor" />

      <div className="mx-auto max-w-5xl px-5 pt-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-1">
          Job Monitor
        </h1>

        {/* Summary header */}
        <div className="mb-4 flex flex-wrap gap-4 text-[13px] text-ink-muted">
          <span>
            <b className="text-ink font-semibold">{data.job_count ?? 0}</b> jobs
          </span>
          <span>
            <b className="text-ink font-semibold">{c.ok ?? 0}</b> healthy
          </span>
          <span>
            <b className="text-ink font-semibold">{c.fail ?? 0}</b> failed
          </span>
          <span>
            <b className="text-ink font-semibold">{c.disabled ?? 0}</b> disabled
          </span>
          <span>
            <b className="text-ink font-semibold">{c.scheduled ?? 0}</b> scheduled
          </span>
          <span>updated {fmtTime(data.generated_at)} UTC</span>
          {data.host && <span>{data.host}</span>}
        </div>

        {/* Legend */}
        <div className="mb-4 flex flex-wrap gap-4 text-[13px] text-ink-muted">
          {LEGEND.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <i className={`h-2.5 w-2.5 rounded-full ${l.dot}`} />
              {l.label}
            </span>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-2">
                {['Name', 'What it does', 'Schedule', 'Last run', 'State'].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line px-3.5 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3.5 py-6 text-center text-sm text-ink-muted">
                    No jobs found.
                  </td>
                </tr>
              ) : (
                data.jobs.map((j, i) => (
                  <tr key={`${j.label}-${i}`} className="align-top hover:bg-panel-2/60">
                    <td className="border-b border-line px-3.5 py-3">
                      <div className="font-semibold text-ink">{j.label}</div>
                      <span className="mt-1 inline-block rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                        {j.source}
                      </span>
                    </td>
                    <td className="border-b border-line px-3.5 py-3 text-[13px] text-ink">
                      {j.description}
                    </td>
                    <td className="whitespace-nowrap border-b border-line px-3.5 py-3 text-[13px] tabular-nums text-ink-muted">
                      {j.schedule_human}
                    </td>
                    <td className="whitespace-nowrap border-b border-line px-3.5 py-3 text-[13px] tabular-nums text-ink-muted">
                      {fmtTime(j.last_run)}
                    </td>
                    <td className="border-b border-line px-3.5 py-3">
                      <StateDot state={j.state} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
