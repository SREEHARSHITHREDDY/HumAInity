import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useAuth, useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Empty, Spinner, Bar, Select, Table, TH, TD, Modal, Label,
} from '../components/ui';
import { shortDate, todayKey } from '../lib/format';
import type { Employee } from '../lib/types';

interface Task {
  id: number; title: string; category: string; mandatory: boolean;
  dueDate: string | null; status: string; assigneeRole: string; notes: string | null;
}
interface Progress {
  employeeId: number; name: string; empCode: string; designation: string;
  total: number; done: number; percent: number;
}

const catTone = (c: string) =>
  c === 'CREDENTIAL' ? 'amber' : c === 'IT' ? 'night' : c === 'TRAINING' ? 'signal' : 'neutral';

export default function Onboarding() {
  const { me } = useAuth();
  const can = useCan();
  const { data: all, reload: reloadAll } = useFetch<Progress[]>(
    can.canSeeDirectory ? '/portal/onboarding' : null);
  const { data: staff } = useFetch<Employee[]>(can.canSeePay ? '/hr/employees' : null);
  const [picked, setPicked] = useState<number | null>(null);
  const subject = can.canSeeDirectory ? (picked ?? all?.[0]?.employeeId ?? null) : me?.employeeId ?? null;

  const { data: tasks, reload } = useFetch<Task[]>(
    subject ? `/portal/onboarding/${subject}` : null, [subject]);
  const [start, setStart] = useState(false);

  const update = async (t: Task, status: string) => {
    await api.patch(`/portal/onboarding/tasks/${t.id}`, { status });
    reload(); reloadAll();
  };

  const list = tasks ?? [];
  const done = list.filter((t) => t.status === 'DONE' || t.status === 'WAIVED').length;

  return (
    <Page title="Onboarding"
          description="New starters work through a checklist with HR, their manager, IT and occupational health."
          actions={can.canSeePay && <Button onClick={() => setStart(true)}>Start onboarding</Button>}>

      {can.canSeeDirectory && (
        <Panel title="In progress">
          {!all ? <div className="py-12 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
            : all.length === 0 ? <Empty title="Nobody is currently onboarding"
                action={can.canSeePay ? <Button size="sm" onClick={() => setStart(true)}>Start onboarding</Button> : undefined} />
            : (
              <Table>
                <thead><tr><TH>Starter</TH><TH>Role</TH><TH align="right">Complete</TH>
                  <TH className="w-[32%]">Progress</TH><TH /></tr></thead>
                <tbody>
                  {all.map((p) => (
                    <tr key={p.employeeId} className={subject === p.employeeId ? 'bg-signal-tint/40' : ''}>
                      <TD><span className="font-medium">{p.name}</span>
                          <span className="block text-[11.5px] text-ink-50 num">{p.empCode}</span></TD>
                      <TD className="text-[13px]">{p.designation}</TD>
                      <TD align="right"><span className="num">{p.done}/{p.total}</span></TD>
                      <TD><Bar value={p.percent} max={100} tone={p.percent === 100 ? 'signal' : 'amber'} /></TD>
                      <TD align="right">
                        <Button size="sm" variant="ghost" onClick={() => setPicked(p.employeeId)}>Open</Button>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Panel>
      )}

      <Panel title={can.canSeeDirectory ? 'Checklist' : 'Your checklist'}
             description={list.length ? `${done} of ${list.length} complete` : undefined}>
        {!subject ? <Empty title="Nothing to show" />
          : list.length === 0 ? <Empty title="No onboarding checklist">
              {can.canSeeDirectory ? 'Start one from the button above.' : 'You have no open onboarding tasks.'}
            </Empty>
          : (
            <ul className="divide-y divide-ink-10/70">
              {list.map((t) => {
                const overdue = t.dueDate && t.dueDate < todayKey() && t.status !== 'DONE' && t.status !== 'WAIVED';
                const mine = t.assigneeRole === 'EMPLOYEE' ? subject === me?.employeeId : t.assigneeRole === me?.role;
                return (
                  <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                    <button
                      onClick={() => update(t, t.status === 'DONE' ? 'PENDING' : 'DONE')}
                      aria-label={t.status === 'DONE' ? 'Mark not done' : 'Mark done'}
                      className={`h-5 w-5 rounded-[4px] border-2 shrink-0 grid place-items-center transition-colors ${
                        t.status === 'DONE' || t.status === 'WAIVED'
                          ? 'bg-signal border-signal text-white' : 'border-ink-30 hover:border-signal'}`}>
                      {(t.status === 'DONE' || t.status === 'WAIVED') && (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13.5px] ${t.status === 'DONE' ? 'line-through text-ink-50' : 'font-medium'}`}>
                        {t.title}
                      </p>
                      <p className="text-[11.5px] text-ink-70">
                        {t.assigneeRole.replace(/_/g, ' ').toLowerCase()}
                        {t.dueDate && ` · due ${shortDate(t.dueDate)}`}
                        {!t.mandatory && ' · optional'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={catTone(t.category) as any}>{t.category.toLowerCase()}</Badge>
                      {overdue && <Badge tone="alert">Overdue</Badge>}
                      {t.status === 'IN_PROGRESS' && <Badge tone="amber">In progress</Badge>}
                      {t.status === 'WAIVED' && <Badge>Waived</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </Panel>

      {start && staff && (
        <StartModal staff={staff} onClose={() => setStart(false)}
                    onDone={(id) => { setStart(false); setPicked(id); reloadAll(); }} />
      )}
    </Page>
  );
}

function StartModal({ staff, onClose, onDone }: {
  staff: Employee[]; onClose: () => void; onDone: (id: number) => void;
}) {
  const [id, setId] = useState<number | ''>('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/portal/onboarding/start', { employeeId: Number(id) }); onDone(Number(id)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Start onboarding">
      <div className="px-5 py-4 space-y-4">
        <div><Label htmlFor="se">Staff member</Label>
          <Select id="se" value={id} onChange={(e) => setId(Number(e.target.value) || '')}>
            <option value="">Choose someone</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} — {s.empCode}</option>)}
          </Select></div>
        <p className="text-[12.5px] text-ink-70">
          Creates the ten standard tasks across HR, IT, the team and occupational health, with
          due dates spread over the first fortnight.
        </p>
        {err && <Banner tone="error" title="Not started">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={go} loading={busy} disabled={!id}>Start onboarding</Button>
      </footer>
    </Modal>
  );
}
