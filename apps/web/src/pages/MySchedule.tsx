import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { Panel, Badge, Empty, Spinner, Banner, Metric } from '../components/ui';
import { hrs, shortDate, dayName, fullDate, todayKey, addDays, eachDay, isWeekend } from '../lib/format';
import type { Shift, Restriction } from '../lib/types';

export default function MySchedule() {
  const from = addDays(todayKey(), -7);
  const to = addDays(todayKey(), 27);
  const { data: shifts, loading } = useFetch<Shift[]>(`/schedule/my?from=${from}&to=${to}`);
  const { data: restrictions } = useFetch<Restriction[]>('/oh/my-restrictions');

  if (loading) return <Page title="My schedule"><div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div></Page>;

  const list = shifts ?? [];
  const byDate = new Map(list.map((s) => [s.date, s]));
  const days = eachDay(from, to);
  const today = todayKey();
  const upcoming = list.filter((s) => s.date >= today);
  const totalHours = upcoming.reduce((a, s) => a + s.hours, 0);
  const nights = upcoming.filter((s) => s.isNight).length;

  return (
    <Page title="My schedule" description="Your shifts for the next four weeks.">
      <div className="grid sm:grid-cols-3 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
        <div className="bg-surface"><Metric label="Shifts ahead" value={upcoming.length} /></div>
        <div className="bg-surface"><Metric label="Hours ahead" value={hrs(totalHours)} /></div>
        <div className="bg-surface"><Metric label="Night shifts" value={nights} tone={nights > 6 ? 'amber' : undefined} /></div>
      </div>

      {(restrictions ?? []).length > 0 && (
        <Banner tone="restricted" title="Restrictions applied to your roster">
          {restrictions!.map((r) => r.description).join(' · ')}. These are applied as hard rules
          when your roster is generated. The reason stays with occupational health.
        </Banner>
      )}

      <Panel title="Four-week view">
        {list.length === 0
          ? <Empty title="Nothing scheduled">Your shifts will appear here once a planner publishes the schedule for your team.</Empty>
          : (
            <div className="p-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-[11px] text-ink-50 font-medium text-center pb-1">{d}</div>
              ))}
              {/* pad to the first Monday */}
              {Array.from({ length: (new Date(days[0]).getUTCDay() + 6) % 7 }).map((_, i) => <div key={`pad${i}`} />)}
              {days.map((d) => {
                const s = byDate.get(d);
                const isToday = d === today;
                return (
                  <div key={d} className={`min-h-[62px] rounded-[4px] border p-1.5
                    ${isToday ? 'border-signal ring-1 ring-signal' : 'border-ink-10'}
                    ${isWeekend(d) && !s ? 'bg-ink-10/30' : 'bg-surface'}`}>
                    <p className={`text-[10.5px] num ${isToday ? 'text-signal-dark font-semibold' : 'text-ink-50'}`}>
                      {shortDate(d)}
                    </p>
                    {s && (
                      <div className={`mt-1 shift ${s.isNight ? 'bg-night text-white' : 'bg-signal-tint text-signal-dark'}`}>
                        {s.templateCode.slice(0, 7)}
                        <span className="block text-[9.5px] opacity-85 font-normal">{s.startTime}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </Panel>

      <Panel title="Upcoming shifts">
        {upcoming.length === 0 ? <Empty title="No upcoming shifts" /> : (
          <ul className="divide-y divide-ink-10/70">
            {upcoming.map((s) => (
              <li key={s.id} className="flex items-center gap-4 px-5 py-3">
                <div className="w-16 shrink-0">
                  <p className="text-[11px] text-ink-50">{dayName(s.date)}</p>
                  <p className="text-[14px] font-semibold num leading-tight">{shortDate(s.date)}</p>
                </div>
                <div className={`w-1 self-stretch rounded-full ${s.isNight ? 'bg-night' : 'bg-signal'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{s.templateName} · {s.departmentName}</p>
                  <p className="text-[12px] text-ink-70 num">{s.startTime}–{s.endTime} · {hrs(s.hours)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {s.isNight && <Badge tone="night">Night</Badge>}
                  {s.isVoluntaryExtra && <Badge tone="signal">Extra hours</Badge>}
                  <Badge tone={s.rosterStatus === 'APPROVED' ? 'signal' : 'neutral'}>{s.rosterStatus}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
