import { isoWeek, type DevQualityRow } from '@/lib/queries';
import { LevelChip } from './LevelChip';
import { QualityBandChip } from './QualityBandChip';

/**
 * Work-quality scorecard for one developer's most recent computed week.
 *
 * This is a COACHING view, not a grade: five named dimensions, each a gentle
 * band + a plain-English line of evidence. No single score, no ranking. The
 * developer's level sits beside the bands as CONTEXT — read a junior's band
 * against a junior's bar — never as a hidden adjustment. Dimensions not yet
 * computed read "Not measured yet" so the view never invents a score.
 *
 * Today only Test Discipline carries data; Stability is next, then the
 * AI-judged signals (Code Care, Review Citizenship, Clarity).
 */
export function QualitySignals({ quality }: { quality: DevQualityRow }) {
  const week = isoWeek(quality.week_start_date);

  const dimensions = [
    {
      label: 'Test Discipline',
      meaning: 'Did new code ship with tests in the same branch?',
      band: quality.test_discipline_band,
      evidence: quality.test_discipline_evidence,
    },
    {
      label: 'Stability',
      meaning: 'How often did the work get reverted or hotfixed?',
      band: quality.stability_band,
      evidence: quality.stability_evidence,
    },
    {
      label: 'Code Care',
      meaning: 'Built to last, or likely to need rework soon?',
      band: quality.code_care_band,
      evidence: quality.code_care_evidence,
    },
    {
      label: 'Review Citizenship',
      meaning: "Helpful, on-time reviews on teammates' pull requests.",
      band: quality.review_citizenship_band,
      evidence: quality.review_citizenship_evidence,
    },
    {
      label: 'Clarity',
      meaning: 'Clear commits and right-sized, easy-to-read changes.',
      band: quality.clarity_band,
      evidence: quality.clarity_evidence,
    },
  ];

  return (
    <section className="px-4 py-3 border-b border-line">
      <div className="mb-1 flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs text-ink-faint uppercase tracking-wide">
          Work quality · Week {week}
        </p>
        {quality.level_snapshot && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
            Read against <LevelChip level={quality.level_snapshot} />
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-ink-faint">
        A coaching view — what&rsquo;s going well, where to help. Not a score, not a ranking.
      </p>

      {quality.headline && (
        <p className="mb-3 text-sm leading-relaxed text-ink">{quality.headline}</p>
      )}

      <ul className="flex flex-col gap-2.5">
        {dimensions.map(d => (
          <li key={d.label} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{d.label}</p>
              <p className="text-[11px] text-ink-faint">{d.meaning}</p>
              {d.evidence && (
                <p className="mt-0.5 text-[11px] text-ink-muted">{d.evidence}</p>
              )}
            </div>
            <QualityBandChip band={d.band} />
          </li>
        ))}
      </ul>

      {quality.needs_a_chat && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Worth a quick chat this week.
        </div>
      )}
    </section>
  );
}
