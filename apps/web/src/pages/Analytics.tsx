import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { Panel, Banner, Badge, Metric, Bar, Table, TH, TD, Spinner, Empty } from '../components/ui';
import { hrs, shortDate, dayName } from '../lib/format';

interface Analytics {
  period: { from: string; to: string };
  headline: {
    activeStaff: number; departments: number; totalHours: number; coveragePct: number;
    slotsRequired: number; slotsFilled: number; nightShifts: number;
    voluntaryExtraHours: number; partTimeShare: number;
  };
  byDepartment: Array<{
    departmentId: number; department: string; headcount: number; suppressed: boolean;
    required: number | null; filled: number | null; coveragePct: number | null; hours: number | null;
  }>;
  trend: Array<{ date: string; hours: number; shifts: number; nights: number; weekend: boolean }>;
  shiftMix: Array<{ code: string; count: number }>;
  leave: { pending: number; approvedDays: number; byType: Array<{ type: string; days: number }> };
  credentials: { total: number; expiringSoon: number; lapsed: number };
  recruitment: { openPostings: number; applications: number; byStage: Array<{ stage: string; count: number }> };
  onboarding: { tasks: number; completed: number; percent: number };
  helpdesk: { open: number };
  scheduling: { rosters: number; lastEngine: string | null; averageRuntimeMs: number | null };
  note: string;
}

export default function AnalyticsPage() {
  const { data, loading } = useFetch<Analytics>('/portal/analytics');

  if (loading) return <Page title="Analytics"><div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div></Page>;
  if (!data) return <Page title="Analytics"><Empty title="No data" /></Page>;

  const h = data.headline;
  const maxHours = Math.max(...data.trend.map((t) => t.hours), 1);
  const maxMix = Math.max(...data.shiftMix.map((s) => s.count), 1);

  return (
    <Page title="Analytics"
          description={`Workforce and operations, ${shortDate(data.period.from)} to ${shortDate(data.period.to)}.`}>

      <Banner tone="restricted">{data.note}</Banner>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
        <div className="bg-surface"><Metric label="Hours scheduled" value={hrs(h.totalHours)}
          sub={`${h.nightShifts} night shifts`} /></div>
        <div className="bg-surface"><Metric label="Coverage" value={h.coveragePct} unit="%"
          tone={h.coveragePct >= 98 ? 'signal' : h.coveragePct >= 90 ? 'amber' : 'alert'}
          sub={`${h.slotsFilled} of ${h.slotsRequired} slots`} /></div>
        <div className="bg-surface"><Metric label="Voluntary extra hours" value={hrs(h.voluntaryExtraHours)}
          sub="taken by choice, paid at 1.5×" /></div>
        <div className="bg-surface"><Metric label="Part-time share" value={h.partTimeShare} unit="%"
          sub={`of ${h.activeStaff} active staff`} /></div>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <Panel title="Hours per day" className="lg:col-span-3"
               description="Scheduled hours across the period. Weekends shaded.">
          <div className="px-5 py-4">
            <div className="flex items-end gap-[3px] h-[170px]">
              {data.trend.map((t) => (
                <div key={t.date} className="flex-1 flex flex-col justify-end items-center group relative">
                  <div className={`w-full rounded-t-[2px] transition-colors ${
                    t.weekend ? 'bg-ink-30' : 'bg-signal'} group-hover:bg-ink`}
                    style={{ height: `${(t.hours / maxHours) * 100}%`, minHeight: t.hours ? 2 : 0 }} />
                  <span className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity
                                   text-[10.5px] num bg-ink text-white px-1.5 py-0.5 rounded-[3px] whitespace-nowrap z-10">
                    {hrs(t.hours)} · {t.shifts} shifts
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[10.5px] text-ink-50 num">
              <span>{shortDate(data.trend[0]?.date ?? '')}</span>
              <span>{shortDate(data.trend[data.trend.length - 1]?.date ?? '')}</span>
            </div>
          </div>
        </Panel>

        <Panel title="Shift mix" className="lg:col-span-2">
          <div className="px-5 py-4 space-y-2.5">
            {data.shiftMix.map((s) => (
              <div key={s.code}>
                <div className="flex justify-between text-[12.5px] mb-1">
                  <span className="font-medium">{s.code}</span>
                  <span className="num text-ink-70">{s.count}</span>
                </div>
                <Bar value={s.count} max={maxMix} tone={s.code === 'NIGHT' ? 'night' : 'signal'} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="By department" description="Departments below the minimum group size are suppressed.">
        <Table>
          <thead><tr><TH>Department</TH><TH align="right">Headcount</TH><TH align="right">Slots</TH>
            <TH align="right">Filled</TH><TH align="right">Coverage</TH><TH align="right">Hours</TH><TH className="w-[22%]" /></tr></thead>
          <tbody>
            {data.byDepartment.map((d) => (
              <tr key={d.departmentId}>
                <TD className="font-medium">{d.department}</TD>
                <TD align="right"><span className="num">{d.headcount}</span></TD>
                <TD align="right"><span className="num">{d.required ?? '—'}</span></TD>
                <TD align="right"><span className="num">{d.filled ?? '—'}</span></TD>
                <TD align="right">
                  {d.suppressed ? <Badge tone="restricted">suppressed</Badge>
                    : <span className="num font-semibold">{d.coveragePct}%</span>}
                </TD>
                <TD align="right"><span className="num">{d.hours != null ? hrs(d.hours) : '—'}</span></TD>
                <TD>{!d.suppressed && <Bar value={d.coveragePct ?? 0} max={100}
                  tone={(d.coveragePct ?? 0) >= 98 ? 'signal' : 'amber'} />}</TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <Panel title="Leave">
          <div className="px-5 py-4 space-y-2 text-[13px]">
            <Row label="Awaiting a decision" value={data.leave.pending} tone={data.leave.pending ? 'amber' : undefined} />
            <Row label="Approved days" value={data.leave.approvedDays} />
            {data.leave.byType.map((t) => (
              <Row key={t.type} label={t.type.toLowerCase()} value={t.days} muted />
            ))}
          </div>
        </Panel>

        <Panel title="Credentials">
          <div className="px-5 py-4 space-y-2 text-[13px]">
            <Row label="Recorded" value={data.credentials.total} />
            <Row label="Expiring within 90 days" value={data.credentials.expiringSoon}
                 tone={data.credentials.expiringSoon ? 'amber' : undefined} />
            <Row label="Lapsed" value={data.credentials.lapsed}
                 tone={data.credentials.lapsed ? 'alert' : undefined} />
          </div>
        </Panel>

        <Panel title="Recruitment">
          <div className="px-5 py-4 space-y-2 text-[13px]">
            <Row label="Open postings" value={data.recruitment.openPostings} />
            <Row label="Applications" value={data.recruitment.applications} />
            {data.recruitment.byStage.map((s) => (
              <Row key={s.stage} label={s.stage.toLowerCase()} value={s.count} muted />
            ))}
          </div>
        </Panel>

        <Panel title="Operations">
          <div className="px-5 py-4 space-y-2 text-[13px]">
            <Row label="Onboarding complete" value={`${data.onboarding.percent}%`} />
            <Row label="Open helpdesk requests" value={data.helpdesk.open}
                 tone={data.helpdesk.open ? 'amber' : undefined} />
            <Row label="Rosters generated" value={data.scheduling.rosters} />
            <Row label="Engine" value={data.scheduling.lastEngine ?? '—'} muted />
            <Row label="Average solve time"
                 value={data.scheduling.averageRuntimeMs ? `${data.scheduling.averageRuntimeMs} ms` : '—'} muted />
          </div>
        </Panel>
      </div>
    </Page>
  );
}

const Row = ({ label, value, tone, muted }: {
  label: string; value: React.ReactNode; tone?: 'amber' | 'alert'; muted?: boolean;
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={muted ? 'text-ink-50' : 'text-ink-70'}>{label}</span>
    <span className={`num font-semibold ${tone === 'alert' ? 'text-alert' : tone === 'amber' ? 'text-amber' : ''}`}>
      {value}
    </span>
  </div>
);
