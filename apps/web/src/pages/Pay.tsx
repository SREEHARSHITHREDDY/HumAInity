import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan, useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { Panel, Button, Banner, Table, TH, TD, Spinner, Empty, Metric, Badge, Modal, Label, Input } from '../components/ui';
import { money, hrs, shortDate } from '../lib/format';

interface Period { id: number; name: string; startDate: string; endDate: string; status: string }
interface Line {
  id: number; employeeId: number; firstName: string; lastName: string; empCode: string;
  contractedHours: number; basePay: number; voluntaryExtraHours: number;
  overtimePay: number; nightHours: number; nightPremiumPay: number; grossPay: number;
}
interface SelfPay extends Line {
  scheduledHours: number; accommodationProtectedHours: number; explanation: string;
}

export default function Pay() {
  const can = useCan();
  const { me } = useAuth();
  const { data: periods, reload } = useFetch<Period[]>(can.canSeePay ? '/workforce/pay/periods' : null);
  const [pid, setPid] = useState<number | null>(null);
  const current = pid ?? periods?.[0]?.id ?? 1;

  const { data: lines, reload: reloadLines } = useFetch<Line[]>(can.canSeePay ? `/workforce/pay/periods/${current}/lines` : null, [current]);
  const { data: equity, reload: reloadEquity } = useFetch<any>(can.canSeePay ? `/workforce/pay/periods/${current}/equity` : null, [current]);
  const { data: self } = useFetch<SelfPay>(!can.canSeePay ? `/workforce/pay/my/${current}` : null, [current]);

  const [busy, setBusy] = useState(false);
  const calculate = async () => {
    setBusy(true);
    try { await api.post(`/workforce/pay/periods/${current}/calculate`); reloadLines(); reloadEquity(); reload(); }
    finally { setBusy(false); }
  };

  /* ── Employee's own payslip ─────────────────────────────────────────── */
  if (!can.canSeePay) {
    return (
      <Page title="My pay" description="What you are paid this period, and why.">
        {!self ? <Panel><Empty title="No pay line yet">Once this period is calculated, your payslip appears here.</Empty></Panel> : (
          <>
            <div className="grid sm:grid-cols-3 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
              <div className="bg-surface"><Metric label="Base pay" value={money(self.basePay)}
                sub={`${hrs(self.contractedHours)} contracted, paid in full`} /></div>
              <div className="bg-surface"><Metric label="Additional earnings"
                value={money(self.overtimePay + self.nightPremiumPay)}
                sub={`${hrs(self.voluntaryExtraHours)} extra · ${hrs(self.nightHours)} nights`} /></div>
              <div className="bg-surface"><Metric label="Gross pay" value={money(self.grossPay)} tone="signal" /></div>
            </div>

            {self.accommodationProtectedHours > 0 && (
              <Banner tone="success" title="Your contracted hours are paid in full">
                {self.explanation} Only you can see this breakdown — your manager and payroll
                see your contracted hours and nothing else.
              </Banner>
            )}

            <Panel title="How this was calculated">
              <Table>
                <thead><tr><TH>Component</TH><TH align="right">Hours</TH><TH align="right">Amount</TH></tr></thead>
                <tbody>
                  <tr><TD>Base pay on contracted hours</TD>
                    <TD align="right"><span className="num">{hrs(self.contractedHours)}</span></TD>
                    <TD align="right"><span className="num">{money(self.basePay)}</span></TD></tr>
                  <tr><TD>Voluntary additional hours at 1.5×</TD>
                    <TD align="right"><span className="num">{hrs(self.voluntaryExtraHours)}</span></TD>
                    <TD align="right"><span className="num">{money(self.overtimePay)}</span></TD></tr>
                  <tr><TD>Night premium</TD>
                    <TD align="right"><span className="num">{hrs(self.nightHours)}</span></TD>
                    <TD align="right"><span className="num">{money(self.nightPremiumPay)}</span></TD></tr>
                  <tr className="bg-paper/60"><TD className="font-semibold">Gross</TD><TD />
                    <TD align="right"><span className="num font-semibold">{money(self.grossPay)}</span></TD></tr>
                </tbody>
              </Table>
            </Panel>

            <Banner tone="info" title="Why a restriction never costs you money">
              Base pay is always calculated from your contracted hours, never from the hours
              you were actually rostered. Additional hours are voluntary and paid at the same
              premium for everyone, so nobody has a financial reason to hide a restriction.
            </Banner>
          </>
        )}
      </Page>
    );
  }

  /* ── Payroll view ───────────────────────────────────────────────────── */
  return (
    <Page title="Pay" description="Payroll's complete view. There is no field here that could reveal a health restriction."
          actions={
            <div className="flex gap-2">
              <select value={current} onChange={(e) => setPid(Number(e.target.value))}
                      className="h-10 px-3 rounded-[4px] border border-ink-30 text-[13px] bg-white">
                {(periods ?? []).map((p) => <option key={p.id} value={p.id}>{shortDate(p.startDate)} – {shortDate(p.endDate)}</option>)}
              </select>
              <Button onClick={calculate} loading={busy}>Calculate pay</Button>
            </div>}>

      {equity && (
        <Banner tone={equity.passed ? 'success' : 'error'}
                title={equity.passed ? 'Pay equity check passed' : 'Pay equity check failed'}>
          {equity.statement}
        </Banner>
      )}

      <Panel title="Pay lines" description="Base pay is computed from contracted hours for every employee, without exception.">
        {!lines ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : lines.length === 0 ? <Empty title="Not calculated yet"
              action={<Button size="sm" onClick={calculate}>Calculate pay</Button>}>
              Run the calculation to produce pay lines for this period.</Empty>
          : (
            <Table>
              <thead><tr>
                <TH>Staff member</TH><TH align="right">Contracted</TH><TH align="right">Base pay</TH>
                <TH align="right">Extra hrs</TH><TH align="right">Overtime</TH>
                <TH align="right">Night premium</TH><TH align="right">Gross</TH>
              </tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <TD><span className="font-medium">{l.firstName} {l.lastName}</span>
                        <span className="block text-[11.5px] text-ink-50 num">{l.empCode}</span></TD>
                    <TD align="right"><span className="num">{hrs(l.contractedHours)}</span></TD>
                    <TD align="right"><span className="num">{money(l.basePay)}</span></TD>
                    <TD align="right"><span className="num">{l.voluntaryExtraHours || '—'}</span></TD>
                    <TD align="right"><span className="num">{l.overtimePay ? money(l.overtimePay) : '—'}</span></TD>
                    <TD align="right"><span className="num">{l.nightPremiumPay ? money(l.nightPremiumPay) : '—'}</span></TD>
                    <TD align="right"><span className="num font-semibold">{money(l.grossPay)}</span></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Panel>
    </Page>
  );
}
