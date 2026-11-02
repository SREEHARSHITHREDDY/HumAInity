import { Link } from 'react-router-dom';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useAuth, useCan } from '../hooks/useAuth';
import { Panel, Metric, Badge, Banner, Bar, Spinner, Empty, Button, Table, TH, TD } from '../components/ui';
import FirewallDiagram from '../components/FirewallDiagram';
import { hrs, shortDate, dayName, fullDate } from '../lib/format';
import type { Fatigue, Capacity, Restriction, Shift } from '../lib/types';

interface Dash {
  role: string;
  solver: { available: boolean; engine: string };
  privacy: { checked: number; clean: boolean; findings: unknown[] };
  auditChain: { valid: boolean; checked: number; brokenAtId: number | null };
  headcount?: number; departments?: number; activeConstraints?: number; pendingLeave?: number;
  fatigue?: { critical: number; high: number; elevated: number; ok: number;
    topRisk: Array<{ employeeId: number; name: string; score: number; band: string }> };
  latestRoster?: { id: number; name: string; status: string; solverStatus: string;
    engine: string; metrics: any } | null;
  fairness?: any;
  myFatigue?: Fatigue; myRestrictions?: Restriction[]; myCapacity?: Capacity;
  upcomingShifts?: Shift[];
}

const BAND = { OK: 'signal', ELEVATED: 'amber', HIGH: 'amber', CRITICAL: 'alert' } as const;

export default function Dashboard() {
  const { me } = useAuth();
  const can = useCan();
  const { data, loading, error } = useFetch<Dash>('/workforce/dashboard');

  if (loading) return <Page title="Overview"><div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div></Page>;
  if (error || !data) return <Page title="Overview"><Banner tone="error" title="Could not load the overview">{error}</Banner></Page>;

  const first = me?.name?.split(' ')[0];

  /* ── Employee view ─────────────────────────────────────────────────── */
  if (data.role === 'EMPLOYEE') {
    const f = data.myFatigue!;
    const cap = data.myCapacity!;
    const next = (data.upcomingShifts ?? []).filter((s) => s.date >= new Date().toISOString().slice(0, 10));
    return (
      <Page title={`Good to see you, ${first}`}
            description="Your shifts, your limits, and what the system holds about you.">
        <div className="grid lg:grid-cols-3 gap-5">
          <Panel title="Your next shifts" className="lg:col-span-2"
                 actions={<Link to="/schedule"><Button variant="ghost" size="sm">Full schedule</Button></Link>}>
            {next.length === 0
              ? <Empty title="No shifts scheduled yet">Once a planner publishes the schedule for your team, your shifts appear here.</Empty>
              : (
                <ul className="divide-y divide-ink-10/70">
                  {next.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="w-14 shrink-0">
                        <p className="text-[11px] text-ink-50">{dayName(s.date)}</p>
                        <p className="text-[15px] font-semibold num leading-tight">{shortDate(s.date)}</p>
                      </div>
                      <div className={`w-1 self-stretch rounded-full ${s.isNight ? 'bg-night' : 'bg-signal'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium">{s.templateName} · {s.departmentName}</p>
                        <p className="text-[12px] text-ink-70 num">{s.startTime}–{s.endTime} · {hrs(s.hours)}</p>
                      </div>
                      {s.isNight && <Badge tone="night">Night</Badge>}
                      {s.isVoluntaryExtra && <Badge tone="signal">Extra hours</Badge>}
                    </li>
                  ))}
                </ul>
              )}
          </Panel>

          <Panel title="Your workload">
            <Metric label="Fatigue score" value={f.score} unit={`/ 100`} tone={BAND[f.band] as any}
                    sub={<Badge tone={BAND[f.band] as any}>{f.band === 'OK' ? 'Within healthy limits' : f.band}</Badge>} />
            <div className="px-5 pb-4">
              <Bar value={f.score} max={100} tone={f.band === 'CRITICAL' ? 'alert' : f.band === 'OK' ? 'signal' : 'amber'} />
              <ul className="mt-3 space-y-1.5">
                {f.drivers.map((d) => <li key={d} className="text-[12.5px] text-ink-70 leading-snug">{d}</li>)}
              </ul>
              <p className="mt-3 pt-3 border-t border-ink-10 text-[11.5px] text-ink-50 leading-snug">
                Calculated from hours, nights and rest gaps only. No health information is used.
              </p>
            </div>
          </Panel>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          <Panel title="Restrictions that apply to you"
                 description="This is exactly what your manager sees — no more, no less.">
            {(data.myRestrictions ?? []).length === 0
              ? <Empty title="No scheduling restrictions">Nothing currently limits how you can be rostered.</Empty>
              : (
                <ul className="divide-y divide-ink-10/70">
                  {data.myRestrictions!.map((r) => (
                    <li key={r.opaqueRef} className="px-5 py-3.5">
                      <p className="text-[13.5px] font-medium">{r.description}</p>
                      <p className="text-[12px] text-ink-70 mt-0.5 num">
                        {fullDate(r.effectiveFrom)} → {r.effectiveTo ? fullDate(r.effectiveTo) : 'no end date'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            <div className="px-5 pb-4 pt-1">
              <Banner tone="restricted">
                The medical reason behind any restriction stays with occupational health.
                You can see who has accessed your record in the audit trail.
              </Banner>
            </div>
          </Panel>

          <Panel title="Additional hours"
                 description="Extra hours are always your choice, and paid at the same premium for everyone.">
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-70">Contracted</span>
                <span className="num text-[15px] font-semibold">{hrs(cap.contractedHoursPerWeek)}/week</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-70">Daily cap applied by the scheduler</span>
                <span className="num text-[15px] font-semibold">{hrs(cap.effectiveDailyCapHours)}</span>
              </div>
              {cap.eligibleForVoluntaryExtra ? (
                <Banner tone="success" title="You can take on additional hours">
                  Up to {hrs(cap.voluntaryExtraCapHours)} extra this period, paid at 1.5×.
                </Banner>
              ) : (
                <Banner tone="info" title="Additional hours are not open to you right now">
                  {cap.blockedReason}. Your contracted hours are paid in full either way.
                </Banner>
              )}
            </div>
          </Panel>
        </div>
      </Page>
    );
  }

  /* ── Staff / management view ───────────────────────────────────────── */
  const fat = data.fatigue!;
  const roster = data.latestRoster;
  const cov = roster?.metrics?.coverage_pct;

  return (
    <Page title={`Good to see you, ${first}`}
          description="Where the workforce stands today, and whether the privacy guarantees still hold.">

      {!data.solver.available && (
        <Banner tone="warn" title="The optimising scheduler is not running">
          Rosters will be generated by the fallback engine. It enforces every hard rule
          but optimises less well. Start it with <span className="num">npm run dev:solver</span>.
        </Banner>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
        <div className="bg-surface"><Metric label="Active staff" value={data.headcount} sub={`across ${data.departments} departments`} /></div>
        <div className="bg-surface"><Metric label="Roster coverage" value={cov ?? '—'} unit={cov ? '%' : undefined}
          tone={cov >= 98 ? 'signal' : cov >= 90 ? 'amber' : 'alert'}
          sub={roster ? `${roster.metrics?.slots_filled ?? 0} of ${roster.metrics?.slots_required ?? 0} slots filled` : 'No roster generated yet'} /></div>
        <div className="bg-surface"><Metric label="Staff at fatigue ceiling" value={fat.critical}
          tone={fat.critical > 0 ? 'alert' : 'signal'}
          sub={`${fat.high} high · ${fat.elevated} elevated · ${fat.ok} within limits`} /></div>
        <div className="bg-surface"><Metric label="Active restrictions" value={data.activeConstraints} tone="restricted"
          sub="applied to schedules without disclosure" /></div>
      </div>

      <Panel title="How a restriction reaches the scheduler"
             description="The only path out of the health store, and what travels along it.">
        <FirewallDiagram activeCount={data.activeConstraints ?? 0} />
        <div className="px-5 pb-5 grid sm:grid-cols-2 gap-3">
          <Banner tone={data.privacy.clean ? 'success' : 'error'}
                  title={data.privacy.clean ? 'Privacy check passed' : 'Privacy check failed'}>
            {data.privacy.clean
              ? `All ${data.privacy.checked} constraints in the operational store were scanned. None contains clinical language.`
              : `${data.privacy.findings.length} constraint(s) contain clinical language. Investigate immediately.`}
          </Banner>
          <Banner tone={data.auditChain.valid ? 'success' : 'error'}
                  title={data.auditChain.valid ? 'Audit log intact' : 'Audit log has been altered'}>
            {data.auditChain.valid
              ? `${data.auditChain.checked} entries verified against the hash chain.`
              : `The chain breaks at entry ${data.auditChain.brokenAtId}.`}
          </Banner>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-5 gap-5">
        <Panel title="Highest workload" className="lg:col-span-3"
               description="Ranked by operational exposure. Nobody above the ceiling can be given extra hours."
               actions={<Link to="/fairness"><Button variant="ghost" size="sm">Fairness</Button></Link>}>
          {fat.topRisk.length === 0 ? <Empty title="No workload data yet">Generate a roster to start tracking fatigue.</Empty> : (
            <Table>
              <thead><tr><TH>Staff member</TH><TH align="right">Score</TH><TH>Band</TH><TH className="w-[36%]">Load</TH></tr></thead>
              <tbody>
                {fat.topRisk.map((r) => (
                  <tr key={r.employeeId}>
                    <TD><Link to={`/people/${r.employeeId}`} className="font-medium hover:text-signal">{r.name}</Link></TD>
                    <TD align="right"><span className="num font-semibold">{r.score}</span></TD>
                    <TD><Badge tone={BAND[r.band as keyof typeof BAND] as any}>{r.band}</Badge></TD>
                    <TD><Bar value={r.score} max={100} tone={r.band === 'CRITICAL' ? 'alert' : r.band === 'OK' ? 'signal' : 'amber'} /></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Latest roster" className="lg:col-span-2"
               actions={can.canSeeDirectory ? <Link to="/rosters"><Button variant="ghost" size="sm">All rosters</Button></Link> : undefined}>
          {!roster ? (
            <Empty title="No roster yet" action={can.canPlan ? <Link to="/rosters"><Button size="sm">Generate a roster</Button></Link> : undefined}>
              Generate one to see coverage, fairness and any staffing shortfalls explained.
            </Empty>
          ) : (
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13.5px] font-medium">{roster.name}</p>
                <Badge tone={roster.status === 'APPROVED' ? 'signal' : roster.status === 'FAILED' ? 'alert' : 'neutral'}>
                  {roster.status}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                <dt className="text-ink-70">Engine</dt>
                <dd className="num text-right">{roster.engine} · {roster.solverStatus}</dd>
                <dt className="text-ink-70">Slots filled</dt>
                <dd className="num text-right">{roster.metrics?.slots_filled} / {roster.metrics?.slots_required}</dd>
                <dt className="text-ink-70">Night-shift spread</dt>
                <dd className="num text-right">{roster.metrics?.night_spread}</dd>
                <dt className="text-ink-70">Restrictions applied</dt>
                <dd className="num text-right">{roster.metrics?.constraints_applied}</dd>
              </dl>
              {data.pendingLeave! > 0 && (
                <Link to="/leave" className="block">
                  <Banner tone="warn">{data.pendingLeave} leave request{data.pendingLeave === 1 ? '' : 's'} awaiting a decision.</Banner>
                </Link>
              )}
            </div>
          )}
        </Panel>
      </div>
    </Page>
  );
}
