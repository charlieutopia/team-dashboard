import { ShellHeader } from '@/components/ShellHeader';
import { GrillAnswers } from '@/components/GrillAnswers';
import { loadGrill } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function GrillPage() {
  let data;
  try {
    data = await loadGrill();
  } catch (err) {
    return (
      <main className="min-h-screen pb-12">
        <ShellHeader active="grill" />
        <div className="mx-auto max-w-3xl px-5 pt-8">
          <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-state-fail">
            Could not load questions.json — {(err as Error).message}.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <ShellHeader active="grill" />
      <div className="mx-auto max-w-3xl px-5 pt-8">
        <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Daily Grill
        </h1>
        <p className="mb-6 text-sm text-ink-muted">
          {data.count} question{data.count === 1 ? '' : 's'} for {data.date}. Answering turns the
          flat wiki into a structured knowledge base — answers file back as structured pages.
        </p>
        {data.questions.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-ink-muted">
            No questions today.
          </p>
        ) : (
          <GrillAnswers questions={data.questions} />
        )}
      </div>
    </main>
  );
}
