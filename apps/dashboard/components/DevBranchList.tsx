import type { ActiveBranchRow } from '@/lib/queries';

function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'unknown time';
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 8) return `${week}w ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}

function ageDays(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

type DerivedStatus =
  | { kind: 'working_on'; branch: ActiveBranchRow }
  | { kind: 'in_progress'; branch: ActiveBranchRow }
  | { kind: 'idle'; branch: ActiveBranchRow; days: number }
  | { kind: 'no_active_branch' };

function deriveStatus(branches: ActiveBranchRow[], now: Date = new Date()): DerivedStatus {
  if (branches.length === 0) return { kind: 'no_active_branch' };
  // branches are pre-sorted newest-first by last_commit_at
  const top = branches[0]!;
  const days = ageDays(top.last_commit_at, now);
  if (days === null) return { kind: 'in_progress', branch: top };
  if (days <= 0) return { kind: 'working_on', branch: top };
  if (days <= 7) return { kind: 'in_progress', branch: top };
  return { kind: 'idle', branch: top, days };
}

function statusLabel(s: DerivedStatus): { text: string; cls: string } {
  switch (s.kind) {
    case 'working_on':
      return {
        text: `Working on ${s.branch.branch_name}`,
        cls: 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-200 dark:border-green-800',
      };
    case 'in_progress':
      return {
        text: `In progress on ${s.branch.branch_name}`,
        cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800',
      };
    case 'idle':
      return {
        text: `Idle ${s.days}d on ${s.branch.branch_name}`,
        cls: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
      };
    case 'no_active_branch':
      return {
        text: 'No active branch',
        cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
      };
  }
}

function firstLine(s: string | null): string {
  if (!s) return '';
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

export function DevBranchList({ branches }: { branches: ActiveBranchRow[] }) {
  const status = deriveStatus(branches);
  const label = statusLabel(status);

  return (
    <div className="mt-3 text-xs">
      <div className="mb-1.5">
        <span
          className={`inline-flex items-center text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-medium ${label.cls}`}
        >
          {label.text}
        </span>
      </div>

      {branches.length > 0 && (
        <ul className="space-y-1.5">
          {branches.map(b => {
            const repoSegments = b.repo_full_name.split('/');
            const branchUrl = `https://github.com/${b.repo_full_name}/tree/${b.branch_name}`;
            return (
              <li key={b.id} className="leading-snug">
                <a
                  href={branchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-blue-600 hover:text-blue-700 break-all"
                  onClick={e => e.stopPropagation()}
                >
                  {b.branch_name}
                </a>
                <span className="text-gray-500">
                  {' '}·{' '}{b.commits_ahead}{' '}commit{b.commits_ahead === 1 ? '' : 's'}
                  {' '}·{' '}{relativeTime(b.last_commit_at)}
                  {' '}·{' '}<span className="text-green-600">+{b.lines_added}</span>
                  {' '}<span className="text-red-600">−{b.lines_removed}</span>
                </span>
                {b.last_commit_message && (
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 truncate ml-0.5">
                    {firstLine(b.last_commit_message)}
                  </p>
                )}
                {repoSegments.length === 2 && repoSegments[1] !== 'utopiaspace' && (
                  <p className="text-[10px] text-gray-400 ml-0.5">
                    in {b.repo_full_name}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
