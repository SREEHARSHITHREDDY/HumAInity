/* The one bold moment in the interface.
 * It is not decoration: it is the mental model the whole product depends on,
 * and people who do not read documentation will read this. */
export default function FirewallDiagram({ activeCount }: { activeCount: number }) {
  return (
    <div className="px-5 py-6">
      <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-4 lg:gap-0 items-stretch">

        {/* Restricted zone */}
        <div className="rounded-l-card border border-restricted/30 bg-restricted-tint/60 p-4 lg:rounded-r-none">
          <p className="text-[11.5px] font-semibold text-restricted flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M9 2.5a3 3 0 0 1 3 3v2H6v-2a3 3 0 0 1 3-3Zm-4 5h8v7H5v-7Z" strokeLinejoin="round" />
            </svg>
            Restricted zone · health.db
          </p>
          <p className="text-[13px] font-medium mt-2.5">Occupational health only</p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-ink-70">
            <li>Diagnosis codes</li>
            <li>Clinical notes</li>
            <li>Medical documents</li>
            <li>Wellbeing check-ins</li>
          </ul>
          <p className="mt-3 pt-3 border-t border-restricted/20 text-[11.5px] text-restricted-dark leading-snug">
            A separate database with its own connection. No foreign key joins it to
            the HR store.
          </p>
        </div>

        {/* The gate */}
        <div className="flex lg:flex-col items-center justify-center gap-3 px-4 py-3 lg:py-0
                        border-y lg:border-y-0 border-ink-10 bg-surface
                        lg:border-x lg:border-ink-30 lg:w-[180px]">
          <div className="text-center">
            <p className="text-[11.5px] font-semibold">Constraint firewall</p>
            <p className="text-[11px] text-ink-50 mt-0.5 leading-snug">5 checks on every crossing</p>
          </div>
          <svg width="92" height="26" viewBox="0 0 92 26" fill="none" aria-hidden className="shrink-0">
            <path d="M2 13h74" stroke="#0B7A6B" strokeWidth="1.5" strokeDasharray="3 3" />
            <path d="M76 8l8 5-8 5z" fill="#0B7A6B" />
          </svg>
          <p className="text-[11px] text-center text-signal-dark font-medium num">
            {activeCount} active
          </p>
        </div>

        {/* Operational zone */}
        <div className="rounded-r-card border border-ink-30 bg-surface p-4 lg:rounded-l-none">
          <p className="text-[11.5px] font-semibold text-signal-dark flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2.5 4.5h13m-13 4h13m-13 4h13" strokeLinecap="round" />
            </svg>
            Operational zone · hr.db
          </p>
          <p className="text-[13px] font-medium mt-2.5">Scheduler, managers, payroll</p>
          <div className="mt-2 rounded-[4px] bg-paper border border-ink-10 p-2.5 num text-[11.5px] leading-relaxed">
            <div className="text-ink-50">{'{'}</div>
            <div className="pl-3"><span className="text-ink-70">type:</span> <span className="text-signal-dark">"MAX_DAILY_HOURS"</span>,</div>
            <div className="pl-3"><span className="text-ink-70">params:</span> {'{ hours: 7.5 }'},</div>
            <div className="pl-3"><span className="text-ink-70">until:</span> <span className="text-signal-dark">"2026-12-29"</span></div>
            <div className="text-ink-50">{'}'}</div>
          </div>
          <p className="mt-3 pt-3 border-t border-ink-10 text-[11.5px] text-ink-70 leading-snug">
            A type, a number and a date. There is no column here that could hold
            a reason.
          </p>
        </div>
      </div>
    </div>
  );
}
