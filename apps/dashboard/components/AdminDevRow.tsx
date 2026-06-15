'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  setActive,
  setReviewer,
  updateDisplayName,
  updateEndDate,
  updateLevel,
  updateOwnedSystems,
  updateTenureNote,
  type DevLevel,
} from '@/app/admin/team/actions';

/** Today's KL date as YYYY-MM-DD — for the "ended vs ends" hint. */
function klTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date());
}

/** "Mon 9, 2026" style label from a YYYY-MM-DD string (no day drift). */
function formatEndDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface Dev {
  id: string;
  github_handle: string;
  display_name: string;
  email: string | null;
  active: boolean;
  level: DevLevel | null;
  tenure_note: string | null;
  is_reviewer: boolean;
  owned_systems: string[];
  end_date: string | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LEVEL_OPTIONS: { value: '' | DevLevel; label: string }[] = [
  { value: '', label: 'Unset' },
  { value: 'intern', label: 'Intern' },
  { value: 'junior', label: 'Junior' },
  { value: 'senior', label: 'Senior' },
  { value: 'freelancer', label: 'Freelancer' },
];

export function AdminDevRow({ dev }: { dev: Dev }) {
  const [name, setName] = useState(dev.display_name);
  const [committed, setCommitted] = useState(dev.display_name);
  const [active, setActiveLocal] = useState(dev.active);
  const [reviewer, setReviewerLocal] = useState(dev.is_reviewer);
  const [level, setLevelLocal] = useState<'' | DevLevel>(dev.level ?? '');
  const [tenure, setTenure] = useState(dev.tenure_note ?? '');
  const [tenureCommitted, setTenureCommitted] = useState(dev.tenure_note ?? '');
  const [systems, setSystems] = useState((dev.owned_systems ?? []).join(', '));
  const [systemsCommitted, setSystemsCommitted] = useState(
    (dev.owned_systems ?? []).join(', '),
  );
  const [endDate, setEndDate] = useState(dev.end_date ?? '');
  const [endDateCommitted, setEndDateCommitted] = useState(dev.end_date ?? '');

  const [nameSave, setNameSave] = useState<SaveState>('idle');
  const [activeSave, setActiveSave] = useState<SaveState>('idle');
  const [reviewerSave, setReviewerSave] = useState<SaveState>('idle');
  const [levelSave, setLevelSave] = useState<SaveState>('idle');
  const [tenureSave, setTenureSave] = useState<SaveState>('idle');
  const [systemsSave, setSystemsSave] = useState<SaveState>('idle');
  const [endDateSave, setEndDateSave] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const anySaving =
    nameSave === 'saving' ||
    activeSave === 'saving' ||
    reviewerSave === 'saving' ||
    levelSave === 'saving' ||
    tenureSave === 'saving' ||
    systemsSave === 'saving' ||
    endDateSave === 'saving';
  const anySaved =
    nameSave === 'saved' ||
    activeSave === 'saved' ||
    reviewerSave === 'saved' ||
    levelSave === 'saved' ||
    tenureSave === 'saved' ||
    systemsSave === 'saved' ||
    endDateSave === 'saved';

  // Auto-clear "saved" badges after 1.5s
  useEffect(() => {
    if (!anySaved) return;
    const t = setTimeout(() => {
      setNameSave(s => (s === 'saved' ? 'idle' : s));
      setActiveSave(s => (s === 'saved' ? 'idle' : s));
      setReviewerSave(s => (s === 'saved' ? 'idle' : s));
      setLevelSave(s => (s === 'saved' ? 'idle' : s));
      setTenureSave(s => (s === 'saved' ? 'idle' : s));
      setSystemsSave(s => (s === 'saved' ? 'idle' : s));
      setEndDateSave(s => (s === 'saved' ? 'idle' : s));
    }, 1500);
    return () => clearTimeout(t);
  }, [anySaved]);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed === committed.trim()) return; // no change
    if (trimmed.length === 0) {
      setErrorMsg('Name cannot be empty');
      setNameSave('error');
      setName(committed); // revert
      return;
    }
    setNameSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateDisplayName(dev.id, trimmed);
      if (result.ok) {
        setCommitted(trimmed);
        setNameSave('saved');
      } else {
        setErrorMsg(result.error);
        setNameSave('error');
        setName(committed); // revert
      }
    });
  }

  function toggleActive() {
    const next = !active;
    setActiveLocal(next);
    setActiveSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await setActive(dev.id, next);
      if (result.ok) {
        setActiveSave('saved');
      } else {
        setActiveLocal(active); // revert
        setErrorMsg(result.error);
        setActiveSave('error');
      }
    });
  }

  function toggleReviewer() {
    const next = !reviewer;
    setReviewerLocal(next);
    setReviewerSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await setReviewer(dev.id, next);
      if (result.ok) {
        setReviewerSave('saved');
      } else {
        setReviewerLocal(reviewer); // revert
        setErrorMsg(result.error);
        setReviewerSave('error');
      }
    });
  }

  function changeLevel(next: '' | DevLevel) {
    const prev = level;
    setLevelLocal(next);
    setLevelSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateLevel(dev.id, next === '' ? null : next);
      if (result.ok) {
        setLevelSave('saved');
      } else {
        setLevelLocal(prev); // revert
        setErrorMsg(result.error);
        setLevelSave('error');
      }
    });
  }

  function commitTenure() {
    const trimmed = tenure.trim();
    if (trimmed === tenureCommitted.trim()) return; // no change
    setTenureSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateTenureNote(dev.id, trimmed);
      if (result.ok) {
        setTenureCommitted(trimmed);
        setTenureSave('saved');
      } else {
        setErrorMsg(result.error);
        setTenureSave('error');
        setTenure(tenureCommitted); // revert
      }
    });
  }

  function commitSystems() {
    const next = systems.trim();
    if (next === systemsCommitted.trim()) return; // no change
    const parsed = systems
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    setSystemsSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateOwnedSystems(dev.id, parsed);
      if (result.ok) {
        // Reflect the normalised (de-duped, trimmed) value back into the input.
        const normalised = parsed.join(', ');
        setSystems(normalised);
        setSystemsCommitted(normalised);
        setSystemsSave('saved');
      } else {
        setErrorMsg(result.error);
        setSystemsSave('error');
        setSystems(systemsCommitted); // revert
      }
    });
  }

  function commitEndDate() {
    const next = endDate.trim();
    if (next === endDateCommitted.trim()) return; // no change
    const value = next.length === 0 ? null : next;
    setEndDateSave('saving');
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateEndDate(dev.id, value);
      if (result.ok) {
        setEndDateCommitted(next);
        setEndDateSave('saved');
        // A past/today end date flips the person inactive server-side. Mirror
        // that locally so the Active toggle reflects reality without a reload.
        if (value !== null && value <= klTodayStr()) {
          setActiveLocal(false);
        }
      } else {
        setErrorMsg(result.error);
        setEndDateSave('error');
        setEndDate(endDateCommitted); // revert
      }
    });
  }

  // Hint shown beside the date input: past → "ended", future → "ends".
  const endHint =
    endDateCommitted.length > 0
      ? endDateCommitted <= klTodayStr()
        ? `ended ${formatEndDate(endDateCommitted)}`
        : `ends ${formatEndDate(endDateCommitted)}`
      : null;

  return (
    <div className={`px-4 py-3 ${!active ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setName(committed);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-full text-base font-medium text-ink bg-transparent border-b border-transparent hover:border-line-strong focus:border-blue-500 focus:outline-none py-0.5"
            aria-label={`Short name for ${dev.github_handle}`}
            disabled={isPending}
          />
          <p className="text-xs text-ink-faint mt-0.5">
            @{dev.github_handle}
            <Link
              href={`/dev/${dev.github_handle}`}
              className="ml-2 text-blue-600 hover:text-blue-700"
            >
              History →
            </Link>
          </p>
          {dev.email && (
            <p className="text-[11px] text-ink-faint mt-0.5 truncate">{dev.email}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={toggleActive}
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              active ? 'bg-green-500' : 'bg-line-strong'
            } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={`Toggle ${dev.display_name} active`}
            aria-pressed={active}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                active ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
            {active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Seniority profile fields */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Level</span>
          <select
            value={level}
            onChange={e => changeLevel(e.target.value as '' | DevLevel)}
            disabled={isPending}
            className="text-sm text-ink bg-card border border-line rounded-md px-2 py-1.5 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            aria-label={`Level for ${dev.display_name}`}
          >
            {LEVEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Reviewer</span>
          <div className="flex items-center gap-2 h-[34px]">
            <button
              type="button"
              onClick={toggleReviewer}
              disabled={isPending}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                reviewer ? 'bg-green-500' : 'bg-line-strong'
              } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-label={`Toggle ${dev.display_name} reviewer`}
              aria-pressed={reviewer}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  reviewer ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-[11px] text-ink-faint">
              {reviewer ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Tenure note</span>
          <input
            type="text"
            value={tenure}
            onChange={e => setTenure(e.target.value)}
            onBlur={commitTenure}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setTenure(tenureCommitted);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="e.g. joined Mar 2026"
            className="text-sm text-ink bg-card border border-line rounded-md px-2 py-1.5 focus:border-blue-500 focus:outline-none placeholder:text-ink-faint disabled:opacity-50"
            aria-label={`Tenure note for ${dev.display_name}`}
            disabled={isPending}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
            Owned systems (comma-separated)
          </span>
          <input
            type="text"
            value={systems}
            onChange={e => setSystems(e.target.value)}
            onBlur={commitSystems}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setSystems(systemsCommitted);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="e.g. billing, auth"
            className="text-sm text-ink bg-card border border-line rounded-md px-2 py-1.5 focus:border-blue-500 focus:outline-none placeholder:text-ink-faint disabled:opacity-50"
            aria-label={`Owned systems for ${dev.display_name}`}
            disabled={isPending}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
            End date
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              onBlur={commitEndDate}
              className="text-sm text-ink bg-card border border-line rounded-md px-2 py-1.5 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              aria-label={`End date for ${dev.display_name}`}
              disabled={isPending}
            />
            {endHint && (
              <span className="text-[11px] text-ink-faint whitespace-nowrap">
                {endHint}
              </span>
            )}
          </div>
        </label>
      </div>

      {(anySaving || anySaved || errorMsg) && (
        <div className="mt-1.5 text-[11px]">
          {anySaving && <span className="text-ink-faint">Saving…</span>}
          {anySaved && !errorMsg && <span className="text-green-600">Saved</span>}
          {errorMsg && <span className="text-red-600">{errorMsg}</span>}
        </div>
      )}
    </div>
  );
}
