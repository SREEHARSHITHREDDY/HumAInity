import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { Panel, Banner, Badge, Table, TH, TD, Spinner, Empty, Metric, Bar } from '../components/ui';
import { hrs, todayKey, addDays, fullDate } from '../lib/format';

interface Metrics {
  employees: number;
  hours: { mean: number; spread: number; gini: number };
  nights: { mean: number; spread: number; gini: number };
  weekends: { mean: number; spread: number; gini: number };
  workload: { mean: number; spread: number; gini: number };
  voluntaryExtra: { mean: number; spread: number; gini: number };
}
interface Scope {
  scope: string; groupSize: number; suppressed: boolean; reason: string | null;
  metrics: Metrics | null; alerts: Array<{ level: string; metric: string; message: string }>;
  department?: string; departmentId?: number;
}
interface Resp { overall: Scope; byDepartment: Scope[]; period: { from: string; to: string }; note: string }

const giniTone = (g: number) => (g > 0.35 ? 'alert' : g > 0.2 ? 'amber' : 'signal');

export default function Fairness() {
  const from = addDays(todayKey(), -27);
  const { data, loading } = useFetch<Resp>(`/workforce/fairness?from=${from}&to=${todayKey()}`);

  if (loading) return <Page title="Fairness"><div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div></Page>;
  if (!data) return <Page title="Fairness"><Empty title="No data" /></Page>;

  const o = data.overall;
  const m = o.metrics;

  return (
    <Page title="Fairness"
          description={`How unwanted work is spread across the team, ${fullDate(data.period.from)} to ${fullDate(data.period.to)}.`}>

      <Banner tone="restricted" title="What this page deliberately cannot do">
        This module never reads the restriction store, so it cannot compare staff by health
        status — publishing that comparison would undo the firewall. Groups below the minimum
        size are suppressed, because a statistic over three people is a statement about three
        identifiable people.
      </Banner>

      {o.suppressed || !m ? (
        <Panel title="Overall"><Empty title="Suppressed">{o.reason}</Empty></Panel>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
            <div className="bg-surface"><Metric label="Night shifts per person" value={m.nights.mean}
              tone={giniTone(m.nights.gini) as any} sub={`spread of ${m.nights.spread} between highest and lowest`} /></div>
            <div className="bg-surface"><Metric label="Hours per person" value={hrs(m.hours.mean)}
              tone={giniTone(m.hours.gini) as any} sub={`spread of ${hrs(m.hours.spread)}`} /></div>
            <div className="bg-surface"><Metric label="Weekend shifts" value={m.weekends.mean}
              tone={giniTone(m.weekends.gini) as any} sub={`spread of ${m.weekends.spread}`} /></div>
            <div className="bg-surface"><Metric label="Voluntary extra hours" value={hrs(m.voluntaryExtra.mean)}
              sub="taken by choice, paid at the same rate for everyone" /></div>
          </div>

          <Panel title="Distribution" description="Gini runs from 0 (perfectly even) to 1 (one person carries everything).">
            <Table>
              <thead><tr><TH>Measure</TH><TH align="right">Mean</TH><TH align="right">Spread</TH>
                <TH align="right">Gini</TH><TH className="w-[30%]">Evenness</TH></tr></thead>
              <tbody>
                {([['Night shifts', m.nights], ['Scheduled hours', m.hours],
                   ['Weekend shifts', m.weekends], ['Weighted workload', m.workload],
                   ['Voluntary extra hours', m.voluntaryExtra]] as const).map(([label, v]) => (
                  <tr key={label}>
                    <TD className="font-medium">{label}</TD>
                    <TD align="right"><span className="num">{v.mean}</span></TD>
                    <TD align="right"><span className="num">{v.spread}</span></TD>
                    <TD align="right"><span className="num font-semibold">{v.gini}</span></TD>
                    <TD><Bar value={1 - v.gini} max={1} tone={giniTone(v.gini) as any} /></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Flags">
            <ul className="divide-y divide-ink-10/70">
              {o.alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <Badge tone={a.level === 'WARN' ? 'amber' : 'neutral'}>{a.level}</Badge>
                  <span className="text-[13px] leading-snug">{a.message}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <Panel title="By department">
        <Table>
          <thead><tr><TH>Department</TH><TH align="right">Staff</TH><TH align="right">Nights (mean)</TH>
            <TH align="right">Hours (mean)</TH><TH>Status</TH></tr></thead>
          <tbody>
            {data.byDepartment.map((d) => (
              <tr key={d.departmentId}>
                <TD className="font-medium">{d.department}</TD>
                <TD align="right"><span className="num">{d.groupSize}</span></TD>
                <TD align="right"><span className="num">{d.suppressed ? '—' : d.metrics!.nights.mean}</span></TD>
                <TD align="right"><span className="num">{d.suppressed ? '—' : hrs(d.metrics!.hours.mean)}</span></TD>
                <TD>{d.suppressed
                  ? <Badge tone="restricted">Suppressed · group too small</Badge>
                  : <Badge tone={d.alerts.some((a) => a.level === 'WARN') ? 'amber' : 'signal'}>
                      {d.alerts.some((a) => a.level === 'WARN') ? 'Review' : 'Even'}</Badge>}</TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </Page>
  );
}
