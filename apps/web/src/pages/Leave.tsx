import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import { Panel, Button, Badge, Table, TH, TD, Empty, Spinner, Modal, Label, Input, Select, Textarea, Banner } from '../components/ui';
import { fullDate, shortDate, todayKey, addDays } from '../lib/format';

interface LeaveRow {
  id: number; leaveType: string; startDate: string; endDate: string; days: number;
  reason: string | null; status: string; employeeId: number;
  firstName: string; lastName: string; empCode: string;
}

const TYPES = ['ANNUAL', 'CASUAL', 'SICK', 'UNPAID', 'COMPENSATORY'];
const label = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

export default function Leave() {
  const can = useCan();
  const { data, loading, reload } = useFetch<LeaveRow[]>('/hr/leave');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    leaveType: 'ANNUAL', startDate: addDays(todayKey(), 14), endDate: addDays(todayKey(), 16), reason: '',
  });

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/hr/leave', form); setOpen(false); reload(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const decide = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    await api.post(`/hr/leave/${id}/decide`, { decision }); reload();
  };

  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING');

  return (
    <Page title="Leave"
          description="Approved leave becomes a hard constraint: the scheduler will not roster anyone who is away."
          actions={can.isEmployee && <Button onClick={() => setOpen(true)}>Request leave</Button>}>

      {can.canSeeDirectory && pending.length > 0 && (
        <Banner tone="warn" title={`${pending.length} request${pending.length === 1 ? '' : 's'} awaiting a decision`}>
          Approving leave immediately affects any roster generated afterwards.
        </Banner>
      )}

      <Panel title={can.canSeeDirectory ? 'All requests' : 'My requests'}>
        {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : rows.length === 0 ? <Empty title="No leave requests"
              action={can.isEmployee ? <Button size="sm" onClick={() => setOpen(true)}>Request leave</Button> : undefined}>
              Requests you make appear here with their status.
            </Empty>
          : (
            <Table>
              <thead><tr>
                {can.canSeeDirectory && <TH>Staff member</TH>}
                <TH>Type</TH><TH>Dates</TH><TH align="right">Days</TH><TH>Note</TH><TH>Status</TH>
                {can.canSeeDirectory && <TH />}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {can.canSeeDirectory && (
                      <TD><span className="font-medium">{r.firstName} {r.lastName}</span>
                          <span className="block text-[11.5px] text-ink-50 num">{r.empCode}</span></TD>
                    )}
                    <TD><Badge tone={r.leaveType === 'SICK' ? 'amber' : 'neutral'}>{label(r.leaveType)}</Badge></TD>
                    <TD className="num text-[12.5px]">{shortDate(r.startDate)} – {shortDate(r.endDate)}</TD>
                    <TD align="right"><span className="num">{r.days}</span></TD>
                    <TD className="text-[12.5px] text-ink-70 max-w-[22ch] truncate">{r.reason ?? '—'}</TD>
                    <TD><Badge tone={r.status === 'APPROVED' ? 'signal' : r.status === 'REJECTED' ? 'alert' : 'neutral'}>
                      {label(r.status)}</Badge></TD>
                    {can.canSeeDirectory && (
                      <TD align="right">
                        {r.status === 'PENDING' && (
                          <span className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="secondary" onClick={() => decide(r.id, 'REJECTED')}>Reject</Button>
                            <Button size="sm" onClick={() => decide(r.id, 'APPROVED')}>Approve</Button>
                          </span>
                        )}
                      </TD>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Panel>

      <Modal open={open} onClose={() => setOpen(false)} title="Request leave">
        <div className="px-5 py-4 space-y-4">
          <div>
            <Label htmlFor="lt">Leave type</Label>
            <Select id="lt" value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="sd">From</Label>
              <Input id="sd" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><Label htmlFor="ed">To</Label>
              <Input id="ed" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div>
            <Label htmlFor="rs">Note for your manager (optional)</Label>
            <Textarea id="rs" rows={2} value={form.reason} placeholder="Travel, family commitment, and so on"
                      onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <p className="text-[11.5px] text-ink-70 mt-1.5">
              Keep this operational. Medical detail belongs with occupational health, not here.
            </p>
          </div>
          {err && <Banner tone="error" title="Request not submitted">{err}</Banner>}
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Submit request</Button>
        </footer>
      </Modal>
    </Page>
  );
}
