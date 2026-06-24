import Link from 'next/link';

// Sticky brand bar shared across every Control Center module page. The shell
// home is `/`; modules link back to it via the "Control Center" wordmark.
export function ShellHeader({ active }: { active?: 'home' | 'monitor' | 'grill' }) {
  const tab = (
    href: string,
    label: string,
    key: 'home' | 'monitor' | 'grill'
  ) => (
    <Link
      href={href}
      className={
        'text-[13px] whitespace-nowrap transition ' +
        (active === key
          ? 'text-ink font-semibold'
          : 'text-ink-muted hover:text-ink')
      }
    >
      {label}
    </Link>
  );

  return (
    <header className="px-5 pt-5 pb-3 sticky top-0 bg-app/85 backdrop-blur z-10 border-b border-line">
      <div className="mx-auto max-w-5xl flex items-center justify-between gap-3">
        <Link href="/" className="text-[15px] font-bold tracking-tight text-ink">
          Control Center
        </Link>
        <nav className="flex items-center gap-4">
          {tab('/', 'Home', 'home')}
          {tab('/monitor', 'Job Monitor', 'monitor')}
          {tab('/grill', 'Daily Grill', 'grill')}
        </nav>
      </div>
    </header>
  );
}
