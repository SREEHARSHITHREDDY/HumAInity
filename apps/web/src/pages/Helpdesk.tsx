import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Empty, Spinner, Modal, Label, Input, Textarea, Select, Table, TH, TD,
} from '../components/ui';
import { stamp } from '../lib/format';

interface Ticket {
  id: number; reference: string; category: string; subject: string; body: string;
  priority: string; status: string; resolution: string | null; createdAt: string;
  raisedById: number; firstName: string; lastName: string; empCode: string;
}

const statusTone = (s: string) =>
  s === 'RESOLVED' || s === 'CLOSED' ? 'signal' : s === 'IN_PROGRESS' ? 'amber' : 'neutral';

export default function Helpdesk() {
  const can = useCan();
  const { data, loading, reload } = useFetch<Ticket[]>('/portal/tickets');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Ticket | null>(null);

  const rows = data ?? [];

  return (
    <Page title="Helpdesk"
          description="Questions about pay, the roster, leave or equipment."
          actions={<Button onClick={() => setOpen(true)}>Raise a request</Button>}>

      <Banner tone="info">
        For anything about a health condition or a work restriction, contact occupational
        health directly rather than raising a ticket here — this queue is read by HR and
        managers.
      </Banner>

      <Panel title={can.canSeeDirectory ? 'All requests' : 'Your requests'}>
        {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : rows.length === 0 ? <Empty title="No requests"
              action={<Button size="sm" onClick={() => setOpen(true)}>Raise a request</Button>}>
              Anything you raise appears here with its status.</Empty>
          : (
            <Table>
              <thead><tr>
                <TH>Reference</TH>{can.canSeeDirectory && <TH>Raised by</TH>}
                <TH>Subject</TH><TH>Category</TH><TH>Priority</TH><TH>Status</TH><TH />
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <TD><span className="num text-[12.5px]">{t.reference}</span>
                        <span className="block text-[11px] text-ink-50">{stamp(t.createdAt)}</span></TD>
                    {can.canSeeDirectory && (
                      <TD className="text-[13px]">{t.firstName} {t.lastName}</TD>
                    )}
                    <TD><button onClick={() => setDetail(t)} className="text-left font-medium hover:text-signal">
                      {t.subject}</button></TD>
                    <TD><Badge>{t.category.toLowerCase()}</Badge></TD>
                    <TD><Badge tone={t.priority === 'HIGH' ? 'alert' : 'neutral'}>{t.priority.toLowerCase()}</Badge></TD>
                    <TD><Badge tone={statusTone(t.status) as any}>{t.status.replace('_', ' ').toLowerCase()}</Badge></TD>
                    <TD align="right"><Button size="sm" variant="ghost" onClick={() => setDetail(t)}>Open</Button></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Panel>

      {open && <NewTicket onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
      {detail && <TicketDetail ticket={detail} canManage={can.canSeeDirectory}
                               onClose={() => setDetail(null)}
                               onDone={() => { setDetail(null); reload(); }} />}
    </Page>
  );
}

function NewTicket({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ category: 'ROSTER', subject: '', body: '', priority: 'NORMAL' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/portal/tickets', form); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Raise a request">
      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="tc">Category</Label>
            <Select id="tc" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['ROSTER', 'PAY', 'LEAVE', 'IT', 'FACILITIES', 'OTHER'].map((c) =>
                <option key={c} value={c}>{c.toLowerCase()}</option>)}
            </Select></div>
          <div><Label htmlFor="tp">Priority</Label>
            <Select id="tp" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['LOW', 'NORMAL', 'HIGH'].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
            </Select></div>
        </div>
        <div><Label htmlFor="ts">Subject</Label>
          <Input id="ts" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
        <div><Label htmlFor="tb">What do you need?</Label>
          <Textarea id="tb" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
        {err && <Banner tone="error" title="Not raised">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!form.subject.trim() || !form.body.trim()}>Raise request</Button>
      </footer>
    </Modal>
  );
}

function TicketDetail({ ticket, canManage, onClose, onDone }: {
  ticket: Ticket; canManage: boolean; onClose: () => void; onDone: () => void;
}) {
  const [status, setStatus] = useState(ticket.status);
  const [resolution, setResolution] = useState(ticket.resolution ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/portal/tickets/${ticket.id}`, { status, resolution }); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${ticket.reference} — ${ticket.subject}`} width="max-w-xl">
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge>{ticket.category.toLowerCase()}</Badge>
          <Badge tone={ticket.priority === 'HIGH' ? 'alert' : 'neutral'}>{ticket.priority.toLowerCase()}</Badge>
          <Badge tone={statusTone(ticket.status) as any}>{ticket.status.replace('_', ' ').toLowerCase()}</Badge>
        </div>
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{ticket.body}</p>
        {ticket.resolution && (
          <Banner tone="success" title="Resolution">{ticket.resolution}</Banner>
        )}
        {canManage && (
          <>
            <div><Label htmlFor="us">Status</Label>
              <Select id="us" value={status} onChange={(e) => setStatus(e.target.value)}>
                {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) =>
                  <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
              </Select></div>
            <div><Label htmlFor="ur">Resolution</Label>
              <Textarea id="ur" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
          </>
        )}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {canManage && <Button onClick={save} loading={busy}>Save</Button>}
      </footer>
    </Modal>
  );
}
