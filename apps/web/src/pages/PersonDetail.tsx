import { useParams, Link } from 'react-router-dom';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { Panel, Badge, Banner, Table, TH, TD, Spinner, Empty, Metric, Bar } from '../components/ui';
import { hrs, fullDate, shortDate, dayName, todayKey, addDays } from '../lib/format';
import type { Employee, Fatigue, Capacity, Shift } from '../lib/types';

export default function PersonDetail() {
  const { id } = useParams();
  const { data: e, loading } = useFetch<Employee & { qualifications: any[] }>(`/hr/employees/${id}`);
  const { data: f } = useFetch<Fatigue>(`/workforce/fatigue/${id}`);
  const { data: cap } = useFetch<Capacity>(`/workforce/capacity/${id}`);
  const { data: shifts } = useFetch<Shift[]>(`/schedule/employee/${id}?from=${todayKey()}&to=${addDays(todayKey(), 20)}`);

  if (loading) return <Page title="Loading"><div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div></Page>;
  if (!e) return <Page title="Not found"><Banner tone="error" title="No such employee">Check the link and try again.</Banner></Page>;

  const band = f?.band ?? 'OK';
  const tone = band === 'CRITICAL' ? 'alert' : band === 'OK' ? 'signal' : 'amber';

  return (
    <Page title={`${e.firstName} ${e.lastName}`}
          description={`${e.empCode} · ${e.designation} · ${e.departmentName}, ${e.facilityName}`}
          actions={<Link to="/people" className="text-[13px] text-ink-70 hover:text-ink">Back to directory</Link>}>

      <div className="grid sm:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
        <div className="bg-surface"><Metric label="Contract" value={hrs(e.contractedHoursPerWeek)} unit="/week"
          sub={e.employmentType === 'FULL_TIME' ? 'Full time' : `Part time · ${e.contractedFte} FTE`} /></div>
        <div className="bg-surface"><Metric label="Daily cap applied" value={cap ? hrs(cap.effectiveDailyCapHours) : '—'}
          sub={cap && cap.effectiveDailyCapHours < 8 ? 'A scheduling restriction applies' : 'Standard'} /></div>
        <div className="bg-surface"><Metric label="Fatigue score" value={f?.score ?? '—'} unit="/ 100" tone={tone as any}
          sub={<Badge tone={tone as any}>{band}</Badge>} /></div>
        <div className="bg-surface"><Metric label="Additional hours" value={cap?.eligibleForVoluntaryExtra ? hrs(cap.voluntaryExtraCapHours) : 'Not open'}
          sub={cap?.blockedReason ?? 'Opted in, below the fatigue ceiling'} /></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Scheduling restrictions" tone="restricted"
               description="What the scheduler and this page are permitted to know.">
          {e.restrictions.length === 0
            ? <Empty title="No restrictions">Nothing currently limits how this person can be rostered.</Empty>
            : (
              <ul className="divide-y divide-ink-10/70">
                {e.restrictions.map((r) => (
                  <li key={r.opaqueRef} className="px-5 py-3.5">
                    <p className="text-[13.5px] font-medium">{r.description}</p>
                    <p className="text-[12px] text-ink-70 mt-0.5 num">
                      {fullDate(r.effectiveFrom)} → {r.effectiveTo ? fullDate(r.effectiveTo) : 'no end date'}
                    </p>
                    <p className="text-[11.5px] text-restricted-dark mt-1.5 leading-snug">{r.note}</p>
                    <p className="text-[10.5px] text-ink-50 num mt-1">ref {r.opaqueRef}</p>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Workload" description="Operational exposure only. No health data is an input.">
          {!f ? <Empty title="No workload data" /> : (
            <div className="px-5 py-4 space-y-4">
              <Bar value={f.score} max={100} tone={tone as any} />
              <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                {[['Hours, last 7 days', hrs(f.components.hoursLast7)],
                  ['Against contracted', `${Math.round(f.components.loadRatio * 100)}%`],
                  ['Consecutive days', f.components.consecutiveDays],
                  ['Nights, last 14 days', f.components.nightsLast14],
                  ['Short turnarounds', f.components.shortRestCount],
                  ['Voluntary extra, 28 days', hrs(f.components.voluntaryExtraLast28)]].map(([l, v]) => (
                  <div key={l as string} className="contents">
                    <dt className="text-ink-70">{l}</dt><dd className="num text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="pt-3 border-t border-ink-10">
                <p className="text-[12px] font-semibold text-ink-70 mb-1">What is driving the score</p>
                <ul className="space-y-0.5">{f.drivers.map((d) => (
                  <li key={d} className="text-[12.5px] text-ink-70 leading-snug">{d}</li>))}</ul>
              </div>
              {f.atCeiling && (
                <Banner tone="error" title="At the fatigue ceiling">
                  This person cannot be allocated additional hours, and cannot waive the limit.
                </Banner>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Qualifications">
          {(e.qualifications ?? []).length === 0 ? <Empty title="No qualifications recorded" /> : (
            <Table>
              <thead><tr><TH>Type</TH><TH>Registration</TH><TH>Expires</TH><TH /></tr></thead>
              <tbody>{e.qualifications.map((q: any) => {
                const soon = q.expiresOn && q.expiresOn <= addDays(todayKey(), 90);
                return (
                  <tr key={q.id}>
                    <TD className="font-medium">{q.type}</TD>
                    <TD className="num text-[12.5px]">{q.registrationNo ?? '—'}</TD>
                    <TD className="num text-[12.5px]">{q.expiresOn ? shortDate(q.expiresOn) : '—'}</TD>
                    <TD align="right">{soon ? <Badge tone="amber">Renew soon</Badge>
                      : q.verified ? <Badge tone="signal">Verified</Badge> : <Badge>Unverified</Badge>}</TD>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Next three weeks">
          {(shifts ?? []).length === 0 ? <Empty title="No shifts scheduled" /> : (
            <ul className="divide-y divide-ink-10/70 max-h-[320px] overflow-y-auto">
              {shifts!.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-14 shrink-0 num text-[12.5px]">
                    <span className="text-ink-50">{dayName(s.date)} </span>{shortDate(s.date)}
                  </span>
                  <span className={`w-1 h-6 rounded-full ${s.isNight ? 'bg-night' : 'bg-signal'}`} />
                  <span className="flex-1 text-[13px]">{s.templateName}</span>
                  <span className="num text-[12.5px] text-ink-70">{hrs(s.hours)}</span>
                  {s.isVoluntaryExtra && <Badge tone="signal">Extra</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Page>
  );
}
