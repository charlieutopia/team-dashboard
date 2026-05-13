'use client';

import { useEffect, useState, useTransition } from 'react';
import { setActive, updateDisplayName } from '@/app/admin/team/actions';

interface Dev {
  id: string;
  github_handle: string;
  display_name: string;
  email: string | null;
  active: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function AdminDevRow({ dev }: { dev: Dev }) {
  const [name, setName] = useState(dev.display_name);
  const [committed, setCommitted] = useState(dev.display_name);
  const [active, setActiveLocal] = useState(dev.active);
  const [nameSave, setNameSave] = useState<SaveState>('idle');
  const [activeSave, setActiveSave] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-clear "saved" badge after 1.5s
  useEffect(() => {
    if (nameSave !== 'saved' && activeSave !== 'saved') return;
    const t = setTimeout(() => {
      if (nameSave === 'saved') setNameSave('idle');
      if (activeSave === 'saved') setActiveSave('idle');
    }, 1500);
    return () => clearTimeout(t);
  }, [nameSave, activeSave]);

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
          <p className="text-xs text-ink-faint mt-0.5">@{dev.github_handle}</p>
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

      {(nameSave !== 'idle' || activeSave !== 'idle' || errorMsg) && (
        <div className="mt-1.5 text-[11px]">
          {(nameSave === 'saving' || activeSave === 'saving') && (
            <span className="text-ink-faint">Saving…</span>
          )}
          {(nameSave === 'saved' || activeSave === 'saved') && !errorMsg && (
            <span className="text-green-600">Saved</span>
          )}
          {errorMsg && <span className="text-red-600">{errorMsg}</span>}
        </div>
      )}
    </div>
  );
}
