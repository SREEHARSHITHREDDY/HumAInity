import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useCan } from '../hooks/useAuth';
import { Panel, Badge, Banner, Table, TH, TD, Spinner, Empty, Metric, Input } from '../components/ui';
import { stamp } from '../lib/format';

interface Entry {
  id: number; at: string; actorEmail: string | null; actorRole: string | null;
  action: string; resourceType: string; resourceId: string | null;
  subjectEmployeeId: number | null; outcome: string; detail: string | null;
}

const toneFor = (a: string, outcome: string) => {
  if (outcome === 'DENIED') return 'alert';
  if (a.startsWith('HEALTH')) return 'restricted';
  if (a.startsWith('FIREWALL')) return 'signal';
  return 'neutral';
};

export default function Audit() {
  const can = useCan();
  const path = can.canAudit ? '/workforce/audit?limit=300' : '/workforce/audit/my-record';
  const { data, loading } = useFetch<Entry[]>(path);
  const { data: chain } = useFetch<{ valid: boolean; checked: number; brokenAtId: number | null }>(
    can.canAudit ? '/workforce/audit/verify' : null);
  const [q, setQ] = useState('');

  const rows = (data ?? []).filter((e) =>
    `${e.action} ${e.actorEmail} ${e.detail ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const denied = (data ?? []).filter((e) => e.outcome === 'DENIED').length;
  const healthReads = (data ?? []).filter((e) => e.action.startsWith('HEALTH')).length;

  return (
    <Page title={can.canAudit ? 'Audit trail' : 'Who has accessed my record'}
          description={can.canAudit
            ? 'Append-only and hash-chained. Each entry carries the hash of the one before it, so removing or editing an entry breaks the chain and is detectable.'
            : 'Every access to your record is logged, and you can see all of it. Transparency about what the system holds on you is a requirement, not a courtesy.'}>

      {can.canAudit && chain && (
        <Banner tone={chain.valid ? 'success' : 'error'}
                title={chain.valid ? 'Chain verified' : 'Chain broken'}>
          {chain.valid
            ? `All ${chain.checked} entries hash correctly against their predecessor. Nothing has been removed or altered.`
            : `The chain breaks at entry ${chain.brokenAtId}. Entries at or after that point cannot be trusted.`}
        </Banner>
      )}

      {can.canAudit && (
        <div className="grid sm:grid-cols-3 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
          <div className="bg-surface"><Metric label="Entries" value={data?.length ?? 0} /></div>
          <div className="bg-surface"><Metric label="Health-store events" value={healthReads} tone="restricted"
            sub="reads, writes and refusals" /></div>
          <div className="bg-surface"><Metric label="Access denied" value={denied} tone={denied ? 'alert' : 'signal'}
            sub="attempts blocked by role checks" /></div>
        </div>
      )}

      <Panel title="Entries" actions={
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action or person"
               className="h-8 w-56 text-[13px]" />}>
        {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : rows.length === 0 ? <Empty title="Nothing logged yet">Actions on records appear here as they happen.</Empty>
          : (
            <Table>
              <thead><tr><TH>When</TH><TH>Action</TH><TH>Who</TH><TH>Detail</TH><TH>Outcome</TH></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <TD className="num text-[12.5px] whitespace-nowrap">{stamp(e.at)}</TD>
                    <TD><Badge tone={toneFor(e.action, e.outcome) as any}>{e.action}</Badge></TD>
                    <TD className="text-[12.5px]">
                      {e.actorEmail ?? 'system'}
                      {e.actorRole && <span className="block text-[11px] text-ink-50">{e.actorRole}</span>}
                    </TD>
                    <TD className="text-[12.5px] text-ink-70 max-w-[46ch]">{e.detail ?? '—'}</TD>
                    <TD><Badge tone={e.outcome === 'SUCCESS' ? 'signal' : 'alert'}>{e.outcome}</Badge></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Panel>
    </Page>
  );
}
