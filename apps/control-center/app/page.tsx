import Link from 'next/link';
import { ShellHeader } from '@/components/ShellHeader';
import { loadJobStatus, loadGrill } from '@/lib/data';

export const dynamic = 'force-dynamic';

// The "Team Activity" module is the existing apps/dashboard deployment. The
// Control Center shell does NOT rebuild it — it links out to it. The URL is
// driven by an env var so dev / preview / prod can each point at the right
// place; the default is the live team-dashboard Vercel project.
const TEAM_ACTIVITY_URL =
  process.env.NEXT_PUBLIC_TEAM_ACTIVITY_URL ?? 'https://team-dashboard.vercel.app';

interface ModuleCard {
  title: string;
  blurb: string;
  href: string;
  external?: boolean;
  meta?: string;
}

export default async function HomePage() {
  // Pull light summary numbers so the cards show "what you get" at a glance.
  const [status, grill] = await Promise.all([
    loadJobStatus().catch(() => null),
    loadGrill().catch(() => null),
  ]);

  const modules: ModuleCard[] = [
    {
      title: 'Team Activity',
      blurb:
        'The Boss view of the team — who shipped what, daily and weekly. The original dashboard, now one module.',
      href: TEAM_ACTIVITY_URL,
      external: true,
      meta: 'Opens the live dashboard',
    },
    {
      title: 'Job Monitor',
      blurb:
        'Every scheduled background job on the Mac in one table — what it does, when it last ran, healthy or broken.',
      href: '/monitor',
      meta: status
        ? `${status.job_count} jobs · ${status.counts.ok ?? 0} healthy · ${
            status.counts.fail ?? 0
          } failed`
        : 'Status file not loaded',
    },
    {
      title: 'Daily Grill',
      blurb:
        'A few sharp questions each day to turn the flat wiki into a structured knowledge base. Answer here; answers file back as structured pages.',
      href: '/grill',
      meta: grill
        ? `${grill.count} questions for ${grill.date}`
        : 'Questions file not loaded',
    },
  ];

  return (
    <main className="min-h-screen pb-12">
      <ShellHeader active="home" />

      <div className="mx-auto max-w-5xl px-5 pt-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink mb-1">
          One place for everything
        </h1>
        <p className="text-sm text-ink-muted mb-8">
          One login, one entry point. Pick a module.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) =>
            m.external ? (
              <a
                key={m.title}
                href={m.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl border border-line bg-panel p-5 transition hover:border-line-strong hover:bg-panel-2"
              >
                <ModuleCardBody m={m} arrow="↗" />
              </a>
            ) : (
              <Link
                key={m.title}
                href={m.href}
                className="group block rounded-xl border border-line bg-panel p-5 transition hover:border-line-strong hover:bg-panel-2"
              >
                <ModuleCardBody m={m} arrow="→" />
              </Link>
            )
          )}
        </div>
      </div>
    </main>
  );
}

function ModuleCardBody({ m, arrow }: { m: ModuleCard; arrow: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-base font-semibold text-ink">{m.title}</h2>
        <span className="text-ink-faint transition group-hover:text-ink">{arrow}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{m.blurb}</p>
      {m.meta && (
        <p className="text-[12px] text-ink-faint font-medium tabular-nums">{m.meta}</p>
      )}
    </>
  );
}
