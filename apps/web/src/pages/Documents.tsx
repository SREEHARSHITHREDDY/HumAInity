import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Empty, Spinner, Modal, Label, Input, Textarea, Select, Table, TH, TD,
} from '../components/ui';
import { shortDate } from '../lib/format';

interface Doc {
  id: number; title: string; category: string; body: string | null; version: string;
  requiresAcknowledgement: boolean; visibleToRoles: string[];
  acknowledged: boolean; acknowledgementCount: number; createdAt: string;
}

export default function Documents() {
  const can = useCan();
  const { data, loading, reload } = useFetch<Doc[]>('/portal/documents');
  const [open, setOpen] = useState<Doc | null>(null);
  const [newDoc, setNewDoc] = useState(false);
  const [report, setReport] = useState<any>(null);

  const docs = data ?? [];
  const outstanding = docs.filter((d) => d.requiresAcknowledgement && !d.acknowledged);

  const acknowledge = async (d: Doc) => {
    await api.post(`/portal/documents/${d.id}/acknowledge`);
    reload(); setOpen(null);
  };

  return (
    <Page title="Documents"
          description="Policies, handbooks and forms. Clinical documents are not kept here."
          actions={can.canSeePay && <Button onClick={() => setNewDoc(true)}>Publish document</Button>}>

      {outstanding.length > 0 && (
        <Banner tone="warn" title={`${outstanding.length} document${outstanding.length === 1 ? '' : 's'} need your acknowledgement`}>
          {outstanding.map((d) => d.title).join(' · ')}
        </Banner>
      )}

      <Panel title="Library">
        {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : docs.length === 0 ? <Empty title="Nothing published yet" />
          : (
            <ul className="divide-y divide-ink-10/70">
              {docs.map((d) => (
                <li key={d.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <button onClick={() => setOpen(d)} className="text-left">
                      <span className="text-[14px] font-medium hover:text-signal">{d.title}</span>
                    </button>
                    <p className="text-[12px] text-ink-70 mt-0.5">
                      {d.category.toLowerCase()} · v{d.version} · published {shortDate(d.createdAt)}
                      {d.visibleToRoles.length > 0 && ` · restricted to ${d.visibleToRoles.length} role(s)`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.requiresAcknowledgement && (
                      d.acknowledged
                        ? <Badge tone="signal">Acknowledged</Badge>
                        : <Button size="sm" onClick={() => acknowledge(d)}>Acknowledge</Button>
                    )}
                    {can.canSeeDirectory && d.requiresAcknowledgement && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        setReport(await api.get(`/portal/documents/${d.id}/acknowledgements`));
                      }}>{d.acknowledgementCount} read</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} width="max-w-2xl">
        {open && (
          <div className="px-5 py-4">
            <p className="text-[12px] text-ink-70 mb-3">{open.category.toLowerCase()} · version {open.version}</p>
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap max-w-[76ch]">{open.body}</p>
          </div>
        )}
        <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>
          {open?.requiresAcknowledgement && !open.acknowledged &&
            <Button onClick={() => acknowledge(open)}>I have read this</Button>}
        </footer>
      </Modal>

      <Modal open={!!report} onClose={() => setReport(null)} title="Acknowledgements" width="max-w-xl">
        {report && (
          <div className="px-5 py-4 space-y-4">
            <p className="text-[13px]">
              <span className="num font-semibold">{report.acknowledged.length}</span> read ·
              <span className="num font-semibold"> {report.outstanding.length}</span> outstanding
            </p>
            {report.outstanding.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-ink-70 mb-1.5">Still to read</p>
                <div className="flex flex-wrap gap-1">
                  {report.outstanding.map((o: any) => <Badge key={o.id}>{o.name}</Badge>)}
                </div>
              </div>
            )}
          </div>
        )}
        <footer className="flex justify-end px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setReport(null)}>Close</Button>
        </footer>
      </Modal>

      {newDoc && <NewDoc onClose={() => setNewDoc(false)} onDone={() => { setNewDoc(false); reload(); }} />}
    </Page>
  );
}

function NewDoc({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    title: '', category: 'POLICY', body: '', version: '1.0', requiresAcknowledgement: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/portal/documents', form); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Publish a document" width="max-w-xl">
      <div className="px-5 py-4 space-y-4">
        <div><Label htmlFor="dt">Title</Label>
          <Input id="dt" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="dc">Category</Label>
            <Select id="dc" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['POLICY', 'FORM', 'HANDBOOK', 'NOTICE', 'TRAINING'].map((c) =>
                <option key={c} value={c}>{c.toLowerCase()}</option>)}
            </Select></div>
          <div><Label htmlFor="dv">Version</Label>
            <Input id="dv" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
        </div>
        <div><Label htmlFor="db">Content</Label>
          <Textarea id="db" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.requiresAcknowledgement}
                 onChange={(e) => setForm({ ...form, requiresAcknowledgement: e.target.checked })} />
          Require every member of staff to acknowledge this
        </label>
        <Banner tone="restricted">
          This library is for operational documents. Medical records and fitness certificates
          belong with occupational health, and an upload containing clinical content is refused.
        </Banner>
        {err && <Banner tone="error" title="Not published">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!form.title.trim()}>Publish</Button>
      </footer>
    </Modal>
  );
}
