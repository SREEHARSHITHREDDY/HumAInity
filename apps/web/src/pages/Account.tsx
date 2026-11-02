import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { Panel, Button, Badge, Banner, Label, Input, Table, TH, TD, Empty, Spinner } from '../components/ui';
import { stamp } from '../lib/format';

interface Session {
  id: number; issuedAt: string; expiresAt: string; revokedAt: string | null;
  userAgent: string | null; ip: string | null;
}

export default function Account() {
  const { me, signOut } = useAuth();
  const { data: sessions, loading, reload } = useFetch<Session[]>('/auth/sessions');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkStrength = async (value: string) => {
    setNext(value);
    if (!value) { setProblem(null); return; }
    const r = await api.post<{ ok: boolean; problem: string | null }>('/auth/password/check', { password: value });
    setProblem(r.problem);
  };

  const change = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const r = await api.post<{ message: string }>('/auth/password', {
        currentPassword: current, newPassword: next,
      });
      setDone(r.message);
      setCurrent(''); setNext(''); setConfirm('');
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const revokeAll = async () => {
    await api.post('/auth/sessions/revoke-all');
    signOut();
    window.location.href = '/login';
  };

  const mismatch = confirm.length > 0 && confirm !== next;
  const active = (sessions ?? []).filter((s) => !s.revokedAt && s.expiresAt > new Date().toISOString());

  return (
    <Page title="Account" description="Your sign-in details and active sessions.">
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Your details">
          <dl className="px-5 py-4 space-y-2.5 text-[13.5px]">
            {[['Name', me?.name], ['Email', me?.email], ['Role', me?.roleLabel],
              ['Employee code', me?.empCode ?? '—'], ['Designation', me?.designation ?? '—']].map(([k, v]) => (
              <div key={k as string} className="flex items-baseline justify-between gap-4 border-b border-ink-10/60 pb-2">
                <dt className="text-ink-70">{k}</dt>
                <dd className="font-medium text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Change your password"
               description="Changing it signs out every other session.">
          <div className="px-5 py-4 space-y-4">
            <div><Label htmlFor="cp">Current password</Label>
              <Input id="cp" type="password" value={current} autoComplete="current-password"
                     onChange={(e) => setCurrent(e.target.value)} /></div>
            <div>
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" value={next} autoComplete="new-password"
                     onChange={(e) => checkStrength(e.target.value)} />
              {problem && <p className="text-[12px] text-amber mt-1.5">{problem}</p>}
              {next && !problem && <p className="text-[12px] text-signal-dark mt-1.5">Strong enough.</p>}
              {!next && <p className="text-[11.5px] text-ink-70 mt-1.5">
                At least 10 characters, with upper and lower case, a digit and a symbol.
              </p>}
            </div>
            <div>
              <Label htmlFor="cf">Confirm new password</Label>
              <Input id="cf" type="password" value={confirm} autoComplete="new-password"
                     onChange={(e) => setConfirm(e.target.value)} />
              {mismatch && <p className="text-[12px] text-alert mt-1.5">These do not match.</p>}
            </div>
            {err && <Banner tone="error" title="Password not changed">{err}</Banner>}
            {done && <Banner tone="success" title="Password changed">{done}</Banner>}
            <Button onClick={change} loading={busy}
                    disabled={!current || !next || !!problem || mismatch || !confirm}>
              Change password
            </Button>
          </div>
        </Panel>
      </div>

      <Panel title="Sessions"
             description="Each sign-in holds a refresh token that rotates on every use. Presenting an old one ends every session, because it means the token was captured."
             actions={active.length > 1 &&
               <Button size="sm" variant="secondary" onClick={revokeAll}>Sign out everywhere</Button>}>
        {loading ? <div className="py-12 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : (sessions ?? []).length === 0 ? <Empty title="No sessions recorded" />
          : (
            <Table>
              <thead><tr><TH>Started</TH><TH>Device</TH><TH>Address</TH><TH>Expires</TH><TH>Status</TH></tr></thead>
              <tbody>
                {sessions!.map((s) => {
                  const expired = s.expiresAt < new Date().toISOString();
                  return (
                    <tr key={s.id}>
                      <TD className="num text-[12.5px]">{stamp(s.issuedAt)}</TD>
                      <TD className="text-[12.5px] max-w-[34ch] truncate">{s.userAgent ?? '—'}</TD>
                      <TD className="num text-[12.5px]">{s.ip ?? '—'}</TD>
                      <TD className="num text-[12.5px]">{stamp(s.expiresAt)}</TD>
                      <TD>
                        {s.revokedAt ? <Badge>signed out</Badge>
                          : expired ? <Badge tone="amber">expired</Badge>
                          : <Badge tone="signal">active</Badge>}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      </Panel>
    </Page>
  );
}
