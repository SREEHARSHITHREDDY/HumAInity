import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Table, TH, TD, Empty, Spinner, Modal, Label, Input, Metric,
} from '../components/ui';
import { hrs, shortDate, dayName, fullDate, stamp, todayKey, addDays, eachDay, isWeekend } from '../lib/format';

interface RosterRow {
  id: number; name: string; periodStart: string; periodEnd: string; status: string;
  solverStatus: string | null; solverEngine: string | null; runtimeMs: number | null;
  generatedAt: string; metrics: any;
}
interface Assignment {
  id: number; date: string; hours: number; isVoluntaryExtra: boolean;
  employeeId: number; firstName: string; lastName: string; empCode: string;
  templateCode: string; templateName: string; startTime: string; endTime: string;
  isNight: boolean; departmentName: string;
}
interface Detail extends RosterRow {
  assignments: Assignment[];
  explanation: { shortfalls: any[]; violations: any[]; firewallRefusals: any[] };
}

export default function Rosters() {
  const can = useCan();
  const { data: list, loading, reload } = useFetch<RosterRow[]>('/schedule/rosters');
  const [selected, setSelected] = useState<number | null>(null);
  const [gen, setGen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [form, setForm] = useState({
    name: '', periodStart: todayKey(), periodEnd: addDays(todayKey(), 13),
  });

  const current = selected ?? list?.[0]?.id ?? null;
  const { data: detail, reload: reloadDetail } = useFetch<Detail>(current ? `/schedule/rosters/${current}` : null, [current]);

  const generate = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await api.post<any>('/schedule/rosters/generate', { ...form, maxTimeSeconds: 25 });
      setResult(r); reload(); setSelected(r.rosterId);
    } catch (e) { setResult({ error: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const approve = async (id: number) => {
    await api.post(`/schedule/rosters/${id}/approve`);
    reload(); reloadDetail();
  };

  return (
    <Page title="Rosters"
          description="Generated with constraint programming. Health restrictions are applied as hard rules; the engine never receives a reason for any of them."
          actions={can.canPlan && <Button onClick={() => setGen(true)}>Generate roster</Button>}>

      {loading && <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>}

      {!loading && (list ?? []).length === 0 && (
        <Panel><Empty title="No rosters yet"
          action={can.canPlan ? <Button onClick={() => setGen(true)}>Generate the first roster</Button> : undefined}>
          A roster assigns staff to every required shift while respecting qualifications,
          leave, working-hour limits and active restrictions.
        </Empty></Panel>
      )}

      {(list ?? []).length > 0 && (
        <Panel title="Generated rosters">
          <Table>
            <thead><tr>
              <TH>Roster</TH><TH>Period</TH><TH>Engine</TH>
              <TH align="right">Coverage</TH><TH align="right">Night spread</TH><TH>Status</TH><TH />
            </tr></thead>
            <tbody>
              {list!.map((r) => (
                <tr key={r.id} className={current === r.id ? 'bg-signal-tint/40' : ''}>
                  <TD>
                    <button onClick={() => setSelected(r.id)} className="text-left">
                      <span className="font-medium hover:text-signal">{r.name}</span>
                      <span className="block text-[11.5px] text-ink-50">{stamp(r.generatedAt)}</span>
                    </button>
                  </TD>
                  <TD><span className="num text-[12.5px]">{shortDate(r.periodStart)} – {shortDate(r.periodEnd)}</span></TD>
                  <TD><span className="num text-[12.5px]">{r.solverEngine}</span>
                      <span className="block text-[11px] text-ink-50">{r.solverStatus} · {r.runtimeMs}ms</span></TD>
                  <TD align="right"><span className="num font-semibold">{r.metrics?.coverage_pct ?? '—'}%</span></TD>
                  <TD align="right"><span className="num">{r.metrics?.night_spread ?? '—'}</span></TD>
                  <TD><Badge tone={r.status === 'APPROVED' ? 'signal' : r.status === 'FAILED' ? 'alert' : 'neutral'}>{r.status}</Badge></TD>
                  <TD align="right">
                    {can.canApprove && r.status === 'DRAFT' &&
                      <Button size="sm" variant="secondary" onClick={() => approve(r.id)}>Approve</Button>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {detail && <RosterDetail detail={detail} />}

      <Modal open={gen} onClose={() => { setGen(false); setResult(null); }} title="Generate roster" width="max-w-xl">
        <div className="px-5 py-4 space-y-4">
          {!result && (
            <>
              <div>
                <Label htmlFor="rn">Roster name</Label>
                <Input id="rn" value={form.name} placeholder="Fortnight roster"
                       onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="ps">From</Label>
                  <Input id="ps" type="date" value={form.periodStart}
                         onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
                <div><Label htmlFor="pe">To</Label>
                  <Input id="pe" type="date" value={form.periodEnd}
                         onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
              </div>
              <Banner tone="info">
                Before solving, the firewall re-checks every restriction and retires any that
                have expired. The engine then receives constraint types and numbers only.
              </Banner>
            </>
          )}

          {result?.error && <Banner tone="error" title="Generation failed">{result.error}</Banner>}

          {result && !result.error && (
            <>
              <Banner tone={result.validatorPassed ? 'success' : 'error'}
                      title={result.validatorPassed ? 'Roster generated' : 'Roster rejected by the validator'}>
                {result.message}
              </Banner>
              <div className="grid grid-cols-3 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
                <div className="bg-surface"><Metric label="Coverage" value={result.metrics.coverage_pct} unit="%" /></div>
                <div className="bg-surface"><Metric label="Engine" value={<span className="text-[15px]">{result.engine}</span>} sub={`${result.runtimeMs} ms · ${result.solverStatus}`} /></div>
                <div className="bg-surface"><Metric label="Restrictions applied" value={result.metrics.constraints_applied} tone="restricted" /></div>
              </div>
              {result.firewall?.refused?.length > 0 && (
                <Banner tone="restricted" title={`Firewall refused ${result.firewall.refused.length} restriction(s)`}>
                  <ul className="mt-1 space-y-0.5">
                    {result.firewall.refused.map((f: any) => (
                      <li key={f.opaqueRef} className="num text-[12px]">{f.opaqueRef.slice(0, 12)}… — {f.reason}</li>
                    ))}
                  </ul>
                </Banner>
              )}
            </>
          )}
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => { setGen(false); setResult(null); }}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && <Button onClick={generate} loading={busy}>Generate roster</Button>}
        </footer>
      </Modal>
    </Page>
  );
}

/* ── The roster grid: days across, people down. Time is the organising axis,
 * so this is a grid and not a list of cards. ─────────────────────────────── */
function RosterDetail({ detail }: { detail: Detail }) {
  const [tab, setTab] = useState<'grid' | 'gaps' | 'checks'>('grid');
  const days = eachDay(detail.periodStart, detail.periodEnd);
  const byEmp = new Map<number, { name: string; code: string; cells: Map<string, Assignment> }>();
  for (const a of detail.assignments) {
    if (!byEmp.has(a.employeeId))
      byEmp.set(a.employeeId, { name: `${a.firstName} ${a.lastName}`, code: a.empCode, cells: new Map() });
    byEmp.get(a.employeeId)!.cells.set(a.date, a);
  }
  const rows = [...byEmp.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const shortfalls = detail.explanation?.shortfalls ?? [];
  const violations = detail.explanation?.violations ?? [];

  const TABS = [
    ['grid', `Roster grid`],
    ['gaps', `Unfilled slots (${shortfalls.length})`],
    ['checks', `Validation`],
  ] as const;

  return (
    <Panel title={detail.name}
           description={`${fullDate(detail.periodStart)} to ${fullDate(detail.periodEnd)} · ${detail.assignments.length} assignments`}>
      <div className="flex gap-1 px-5 pt-3 border-b border-ink-10">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`px-3 h-9 text-[13px] rounded-t-[4px] border-b-2 -mb-px transition-colors ${
              tab === k ? 'border-signal text-ink font-medium' : 'border-transparent text-ink-70 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'grid' && (
        <div className="overflow-x-auto">
          <table className="text-[11.5px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-semibold text-ink-70 border-b border-ink-10 min-w-[170px]">
                  Staff member
                </th>
                {days.map((d) => (
                  <th key={d} className={`px-1.5 py-2 border-b border-ink-10 font-medium min-w-[62px]
                                          ${isWeekend(d) ? 'bg-ink-10/50' : 'bg-surface'}`}>
                    <span className="block text-ink-50 text-[10px]">{dayName(d)}</span>
                    <span className="num">{shortDate(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, r]) => (
                <tr key={id}>
                  <td className="sticky left-0 z-10 bg-surface px-4 py-1.5 border-b border-ink-10/60 whitespace-nowrap">
                    <span className="font-medium text-[12.5px]">{r.name}</span>
                    <span className="block text-ink-50 num text-[10.5px]">{r.code}</span>
                  </td>
                  {days.map((d) => {
                    const a = r.cells.get(d);
                    return (
                      <td key={d} className={`px-1 py-1 border-b border-ink-10/60 ${isWeekend(d) ? 'bg-ink-10/30' : ''}`}>
                        {a && (
                          <div className={`shift ${a.isNight ? 'bg-night text-white'
                            : a.isVoluntaryExtra ? 'bg-signal text-white' : 'bg-signal-tint text-signal-dark'}`}
                            title={`${a.templateName} ${a.startTime}–${a.endTime} · ${a.departmentName}`}>
                            {a.hours}h
                            <span className="block text-[9.5px] opacity-80 font-normal">{a.templateCode.slice(0, 5)}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-ink-10 text-[11.5px] text-ink-70">
            <span className="flex items-center gap-1.5"><i className="h-3 w-5 rounded-[2px] bg-signal-tint block" /> Day shift</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-5 rounded-[2px] bg-night block" /> Night shift</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-5 rounded-[2px] bg-signal block" /> Voluntary extra hours</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-5 rounded-[2px] bg-ink-10 block" /> Weekend</span>
          </div>
        </div>
      )}

      {tab === 'gaps' && (
        shortfalls.length === 0
          ? <Empty title="Every slot is filled">The engine covered all required staffing for this period.</Empty>
          : (
            <ul className="divide-y divide-ink-10/70">
              {shortfalls.map((s: any, i: number) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="num text-[13px] font-semibold">{fullDate(s.date)}</span>
                    <Badge tone="alert">{s.missing} of {s.required} unfilled</Badge>
                    <span className="text-[12.5px] text-ink-70">{s.template_code}</span>
                  </div>
                  <div className="mt-2.5 grid md:grid-cols-2 gap-x-6 gap-y-2">
                    <div>
                      <p className="text-[12px] font-semibold text-ink-70 mb-1">Why it could not be filled</p>
                      <ul className="space-y-0.5">
                        {s.reasons.map((r: string, j: number) => (
                          <li key={j} className="text-[12.5px] text-ink-70 leading-snug">{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-ink-70 mb-1">What you can do</p>
                      <ul className="space-y-0.5">
                        {s.alternatives.map((r: string, j: number) => (
                          <li key={j} className="text-[12.5px] text-signal-dark leading-snug">{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
      )}

      {tab === 'checks' && (
        <div className="px-5 py-4 space-y-3">
          <Banner tone={violations.length === 0 ? 'success' : 'error'}
                  title={violations.length === 0 ? 'Independent validation passed' : `${violations.length} hard-rule violation(s)`}>
            {violations.length === 0
              ? 'The roster was re-checked against every hard rule by a validator that does not share code with the solver. No qualification, leave, rest, working-hour or restriction rule was broken.'
              : 'This roster cannot be approved. Each violation is listed below.'}
          </Banner>
          {violations.length > 0 && (
            <Table>
              <thead><tr><TH>Rule</TH><TH>Employee</TH><TH>Date</TH><TH>Detail</TH></tr></thead>
              <tbody>{violations.map((v: any, i: number) => (
                <tr key={i}><TD><Badge tone="alert">{v.rule}</Badge></TD>
                  <TD className="num">{v.employeeId}</TD><TD className="num">{v.date ?? '—'}</TD>
                  <TD className="text-[12.5px]">{v.detail}</TD></tr>
              ))}</tbody>
            </Table>
          )}
          <dl className="grid sm:grid-cols-3 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden text-[13px]">
            {[['Hours per person', Object.keys(detail.metrics?.hours_per_employee ?? {}).length],
              ['Voluntary extra assignments', detail.metrics?.voluntary_extra_assignments ?? 0],
              ['Restrictions applied', detail.metrics?.constraints_applied ?? 0]].map(([l, v]) => (
              <div key={l as string} className="bg-surface px-4 py-3">
                <dt className="text-[12px] text-ink-70">{l}</dt>
                <dd className="num text-[18px] font-semibold mt-0.5">{v as number}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  );
}
