import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth, useCan } from '../hooks/useAuth';
import { useFetch } from '../hooks/useApi';

/* Icons are inline so the app carries no icon dependency. */
const I = {
  home:   <path d="M3 8.5 9 3.5l6 5V15a.5.5 0 0 1-.5.5h-3.5v-4h-4v4H3.5A.5.5 0 0 1 3 15V8.5Z" />,
  cal:    <path d="M3.5 4.5h11v10h-11v-10Zm0 3h11M6 3v3m6-3v3" />,
  grid:   <path d="M2.5 4.5h13m-13 4h13m-13 4h13M6 3v11m4-11v11" />,
  people: <path d="M6.5 8a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm5.5.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM2.5 14.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5m1-3.2c1.7.1 3 1.2 3 3.2" />,
  heart:  <path d="M9 14.5S3.5 11 3.5 7.2A2.7 2.7 0 0 1 9 6.1a2.7 2.7 0 0 1 5.5 1.1C14.5 11 9 14.5 9 14.5Z" />,
  scale:  <path d="M9 3v12M4.5 6h9M4.5 6 2.5 11h4l-2-5Zm9 0-2 5h4l-2-5Z" />,
  rupee:  <path d="M5.5 3.5h7m-7 3h7m-7 0c3 0 4.5 1 4.5 2.5S8.5 11.5 5.5 11.5l5 3.5" />,
  shield: <path d="M9 2.5 14 4.5v4c0 3.2-2.1 5.6-5 6.5-2.9-.9-5-3.3-5-6.5v-4L9 2.5Z" />,
  log:    <path d="M4 3.5h10v11H4v-11Zm2.5 3h5m-5 2.5h5m-5 2.5h3" />,
  book:   <path d="M4 3.5h5a2 2 0 0 1 2 2v9a1.75 1.75 0 0 0-1.75-1.75H4v-9.25Zm10 0H9.5" />,
  star:   <path d="M9 3l1.8 3.9L15 7.5l-3 3 .8 4.3L9 12.8 5.2 14.8 6 10.5l-3-3 4.2-.6L9 3Z" />,
  user:   <path d="M9 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-5 6c0-2.4 2.2-4 5-4s5 1.6 5 4" />,
  check:  <path d="M3.5 9.5l3.5 3.5 7.5-8" />,
  file:   <path d="M5 2.5h5l3 3v10H5v-13Zm5 0v3h3" />,
  chat:   <path d="M3.5 4.5h11v8H8l-3.5 2.5v-2.5h-1v-8Z" />,
  chart:  <path d="M3.5 14.5v-5m4 5v-9m4 9v-3m4 3v-11" />,
  exit:   <path d="M10.5 4.5h3v9h-3M11 9H4m0 0 2.5-2.5M4 9l2.5 2.5" />,
  life:   <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-3.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4.2-6.3 2.4 2.4m3.6 3.6 2.4 2.4m0-8.4-2.4 2.4m-3.6 3.6-2.4 2.4" />,
  gear:   <path d="M9 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm6-2.25-1.6-.4a4.6 4.6 0 0 0-.4-1l.9-1.4-1.1-1.1-1.4.9a4.6 4.6 0 0 0-1-.4L10 3.9H8.5l-.4 1.7a4.6 4.6 0 0 0-1 .4l-1.4-.9L4.6 6.2l.9 1.4a4.6 4.6 0 0 0-.4 1L3.4 9v1.5l1.7.4c.1.35.24.68.4 1l-.9 1.4 1.1 1.1 1.4-.9c.32.16.65.3 1 .4l.4 1.7H10l.4-1.7c.35-.1.68-.24 1-.4l1.4.9 1.1-1.1-.9-1.4c.16-.32.3-.65.4-1l1.6-.4V9Z" />,
  spark:  <path d="M9 2.5 10.4 7 15 8.5 10.4 10 9 14.5 7.6 10 3 8.5 7.6 7 9 2.5Z" />,
  seal:   <path d="M9 2.5a3 3 0 0 1 3 3v2H6v-2a3 3 0 0 1 3-3Zm-4 5h8v7H5v-7Z" />,
};
const Icon = ({ d, className }: { d: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
       className={clsx('shrink-0', className)} aria-hidden>{d}</svg>
);

interface NavItem { to: string; label: string; icon: React.ReactNode; show: boolean }

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { me, signOut } = useAuth();
  const can = useCan();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: notes } = useFetch<Array<{ id: number; readAt: string | null }>>('/hr/notifications');
  const unread = (notes ?? []).filter((n) => !n.readAt).length;

  /* Grouped, because a flat list of fifteen links is a list nobody reads. */
  const groups: Array<{ heading: string | null; items: NavItem[] }> = [
    {
      heading: null,
      items: [
        { to: '/',          label: 'Overview',    icon: I.home, show: true },
        { to: '/assistant', label: 'Assistant',   icon: I.chat, show: true },
      ],
    },
    {
      heading: 'My work',
      items: [
        { to: '/schedule',  label: 'My schedule', icon: I.cal,   show: can.isEmployee },
        { to: '/leave',     label: 'Leave',       icon: I.book,  show: true },
        { to: '/wellbeing', label: 'Wellbeing',   icon: I.heart, show: can.isEmployee },
        { to: '/capacity',  label: 'Work capacity', icon: I.life, show: can.isEmployee },
        { to: '/pay',       label: 'Pay',         icon: I.rupee, show: true },
      ],
    },
    {
      heading: 'Workforce',
      items: [
        { to: '/rosters',     label: 'Rosters',     icon: I.grid,   show: can.canSeeDirectory },
        { to: '/people',      label: 'People',      icon: I.people, show: can.canSeeDirectory },
        { to: '/performance', label: 'Performance', icon: I.star,   show: true },
        { to: '/fairness',    label: 'Fairness',    icon: I.scale,  show: can.canSeeDirectory },
        { to: '/analytics',   label: 'Analytics',   icon: I.chart,  show: can.canSeeDirectory },
      ],
    },
    {
      heading: 'Employee lifecycle',
      items: [
        { to: '/recruitment', label: 'Recruitment', icon: I.user,  show: can.canSeeDirectory },
        { to: '/onboarding',  label: 'Onboarding',  icon: I.check, show: true },
        { to: '/offboarding', label: 'Offboarding', icon: I.exit,  show: can.canSeeDirectory },
      ],
    },
    {
      heading: 'Support',
      items: [
        { to: '/documents', label: 'Documents',   icon: I.file, show: true },
        { to: '/helpdesk',  label: 'Helpdesk',    icon: I.life, show: true },
        { to: '/audit',     label: 'Audit trail', icon: I.log,  show: true },
      ],
    },
  ];

  const rail = (
    <nav className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="6" fill="#0E2A33" />
            <path d="M9 10v12M9 16h7M16 10v12" stroke="#0B7A6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <rect x="20" y="13" width="5" height="6" rx="1.5" fill="#6B3FA0" />
          </svg>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">HumAInity</p>
            <p className="text-[11px] text-ink-50">Workforce &amp; scheduling</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2">
        {groups.map((g, gi) => {
          const items = g.items.filter((n) => n.show);
          if (!items.length) return null;
          return (
            <div key={g.heading ?? gi} className={gi === 0 ? '' : 'mt-4'}>
              {g.heading && (
                <p className="px-2.5 pb-1 text-[11px] font-semibold text-ink-50">{g.heading}</p>
              )}
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
                    className={({ isActive }) => clsx(
                      'flex items-center gap-2.5 px-2.5 h-[34px] rounded-[4px] text-[13.5px] transition-colors',
                      isActive ? 'bg-ink text-white font-medium' : 'text-ink-70 hover:bg-ink-10 hover:text-ink')}>
                    <Icon d={n.icon} /> {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}

        {/* ── The restricted zone is set apart spatially and by colour. The
            boundary in the data model is a boundary you can see. ───────── */}
        {can.isOh && (
          <div className="pt-4 mt-3 border-t border-ink-10">
            <p className="px-2.5 pb-1.5 text-[11px] text-restricted font-semibold flex items-center gap-1.5">
              <Icon d={I.seal} className="w-3.5 h-3.5" /> Restricted zone
            </p>
            <NavLink to="/occupational-health" onClick={() => setOpen(false)}
              className={({ isActive }) => clsx(
                'flex items-center gap-2.5 px-2.5 h-9 rounded-[4px] text-[13.5px] border-l-2 ml-0.5',
                isActive
                  ? 'bg-restricted text-white border-restricted font-medium'
                  : 'text-restricted-dark border-restricted/40 hover:bg-restricted-tint')}>
              <Icon d={I.heart} /> Occupational health
            </NavLink>
            <p className="px-2.5 pt-2 text-[11px] text-ink-50 leading-snug">
              Clinical records are visible only here, and every access is logged.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-ink-10 p-3">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="h-8 w-8 rounded-full bg-ink text-white grid place-items-center text-[12px] font-semibold shrink-0">
            {me?.name?.split(' ').map((s) => s[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-[13px] font-medium truncate">{me?.name}</p>
            <p className="text-[11px] text-ink-50 truncate">{me?.roleLabel}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <NavLink to="/account" onClick={() => setOpen(false)}
            className={({ isActive }) => clsx(
              'flex-1 h-8 rounded-[4px] text-[13px] grid place-items-center transition-colors',
              isActive ? 'bg-ink-10 text-ink font-medium' : 'text-ink-70 hover:bg-ink-10 hover:text-ink')}>
            Account
          </NavLink>
          <button onClick={() => { signOut(); nav('/login'); }}
            className="flex-1 h-8 rounded-[4px] text-[13px] text-ink-70 hover:bg-ink-10 hover:text-ink transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid" style={{ gridTemplateColumns: 'var(--rail) 1fr' }}>
      <aside className="hidden lg:block border-r border-ink-10 bg-surface sticky top-0 h-screen">{rail}</aside>

      {/* Mobile */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-surface border-b border-ink-10">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 -ml-2">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>
        <p className="font-semibold">HumAInity</p>
        <span className="relative">
          {unread > 0 && <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-alert text-white text-[10px] grid place-items-center num">{unread}</span>}
          <Icon d={I.spark} />
        </span>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <div className="absolute left-0 top-0 bottom-0 w-[260px] bg-surface" onClick={(e) => e.stopPropagation()}>{rail}</div>
        </div>
      )}

      <main className="min-w-0"><div className="rise">{children}</div></main>
    </div>
  );
}

export const Page = ({ title, description, actions, children }: {
  title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
}) => (
  <>
    <header className="px-5 sm:px-8 pt-7 pb-5 border-b border-ink-10 bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-4 max-w-[1400px]">
        <div>
          <h1 className="text-[26px] leading-none font-semibold tracking-[-0.015em]">{title}</h1>
          {description && <p className="text-[13.5px] text-ink-70 mt-2 max-w-[76ch] leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
    <div className="px-5 sm:px-8 py-6 max-w-[1400px] space-y-5">{children}</div>
  </>
);
