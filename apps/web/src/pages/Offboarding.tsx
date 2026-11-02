import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Empty, Spinner, Modal, Label, Input, Select, Bar,
} from '../components/ui';
import { fullDate, shortDate, todayKey, addDays } from '../lib/format';
import type { Employee } from '../lib/types';

interface Case {
  id: number; employeeId: number; lastWorkingDay: string; reason: string; status: string;
  checklist: Array<{ key: string; label: string; done: boolean }>;
  accessRevokedAt: string | null; healthRecordsHandledBy: string | null;
  firstName: string; lastName: string; empCode: string;
}

export default function Offboarding() {
  const can = useCan();
  const { data, loading, reload } = useFetch<Case[]>('/portal/offboarding');
  const { data: staff } = useFetch<Employee[]>(can.canSeePay ? '/hr/employees' : null);
  const [open, setOpen] = useState(false);

  const toggle = async (c: Case, key: string, done: boolean) => {
    await api.patch(`/portal/offboarding/${c.id}`, { key, done });
    reload();
  };

  const cases = data ?? [];

  return (
    <Page title="Offboarding"
          description="Exit workflow. Revoking access here really does deactivate the account and end every session."
          actions={can.canSeePay && <Button onClick={() => setOpen(true)}>Open an exit case</Button>}>

      <Banner tone="restricted" title="Health records are not handled here">
        This checklist does not touch occupational health records. Their retention is decided by
        occupational health under their own rules, which is why the last item is a referral
        rather than a deletion — an HR workflow should not be able to delete clinical data it
        cannot even read.
      </Banner>

      {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
        : cases.length === 0 ? <Panel><Empty title="No exit cases open"
            action={can.canSeePay ? <Button size="sm" onClick={() => setOpen(true)}>Open an exit case</Button> : undefined}>
            An exit case tracks handover, equipment, access revocation and final pay.</Empty></Panel>
        : cases.map((c) => {
          const done = c.checklist.filter((x) => x.done).length;
          return (
            <Panel key={c.id} title={`${c.firstName} ${c.lastName}`}
                   description={`${c.empCode} · last working day ${fullDate(c.lastWorkingDay)} · ${c.reason.replace(/_/g, ' ').toLowerCase()}`}
                   actions={<Badge tone={c.status === 'COMPLETED' ? 'signal' : 'amber'}>{c.status.replace('_', ' ').toLowerCase()}</Badge>}>
              <div className="px-5 py-4">
                <div className="flex items-center gap-3 mb-4">
                  <Bar value={done} max={c.checklist.length} tone={done === c.checklist.length ? 'signal' : 'amber'} />
                  <span className="num text-[12.5px] text-ink-70 shrink-0">{done}/{c.checklist.length}</span>
                </div>
                <ul className="space-y-1">
                  {c.checklist.map((item) => (
                    <li key={item.key} className="flex items-center gap-3 py-1.5">
                      <button onClick={() => can.canSeePay && toggle(c, item.key, !item.done)}
                        disabled={!can.canSeePay}
                        aria-label={item.done ? 'Mark not done' : 'Mark done'}
                        className={`h-5 w-5 rounded-[4px] border-2 shrink-0 grid place-items-center transition-colors ${
                          item.done ? 'bg-signal border-signal text-white' : 'border-ink-30 hover:border-signal'
                        } ${!can.canSeePay ? 'cursor-default' : ''}`}>
                        {item.done && (
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span className={`text-[13.5px] ${item.done ? 'text-ink-50 line-through' : ''}`}>{item.label}</span>
                      {item.key === 'access' && c.accessRevokedAt && (
                        <Badge tone="alert">account deactivated {shortDate(c.accessRevokedAt)}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
                {c.healthRecordsHandledBy && (
                  <p className="mt-3 pt-3 border-t border-ink-10 text-[12px] text-restricted-dark">
                    {c.healthRecordsHandledBy}
                  </p>
                )}
              </div>
            </Panel>
          );
        })}

      {open && staff && (
        <OpenCase staff={staff} onClose={() => setOpen(false)}
                  onDone={() => { setOpen(false); reload(); }} />
      )}
    </Page>
  );
}

function OpenCase({ staff, onClose, onDone }: {
  staff: Employee[]; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    employeeId: '' as number | '', lastWorkingDay: addDays(todayKey(), 30), reason: 'RESIGNATION',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/portal/offboarding', form); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Open an exit case">
      <div className="px-5 py-4 space-y-4">
        <div><Label htmlFor="oe">Staff member</Label>
          <Select id="oe" value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) || '' })}>
            <option value="">Choose someone</option>
            {staff.filter((s) => s.status === 'ACTIVE').map((s) =>
              <option key={s.id} value={s.id}>{s.firstName} {s.lastName} — {s.empCode}</option>)}
          </Select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="ol">Last working day</Label>
            <Input id="ol" type="date" value={form.lastWorkingDay}
                   onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} /></div>
          <div><Label htmlFor="or">Reason</Label>
            <Select id="or" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {['RESIGNATION', 'END_OF_CONTRACT', 'RETIREMENT', 'OTHER'].map((r) =>
                <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}
            </Select></div>
        </div>
        {err && <Banner tone="error" title="Not opened">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!form.employeeId}>Open case</Button>
      </footer>
    </Modal>
  );
}
