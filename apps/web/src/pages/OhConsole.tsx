import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Table, TH, TD, Empty, Spinner, Modal,
  Label, Input, Select, Textarea, Metric,
} from '../components/ui';
import { fullDate, shortDate, stamp, todayKey, addDays } from '../lib/format';
import type { Employee } from '../lib/types';

interface Assessment {
  id: number; employeeRef: number; assessedBy: string; assessmentDate: string;
  fitnessStatus: string; clinicalNotes: string | null; diagnosisCode: string | null;
  reviewDate: string | null;
}
interface SourceRestriction {
  id: number; employeeRef: number; assessmentId: number; restrictionType: string;
  params: string; effectiveFrom: string; effectiveTo: string | null;
  status: string; opaqueRef: string; projectedAt: string | null; authorizedBy: string;
}
interface CType { type: string; label: string; paramsSchema: string[] }

export default function OhConsole() {
  const { data: staff } = useFetch<Employee[]>('/hr/employees');
  const { data: assessments, reload: reloadA, error: assessmentsError } = useFetch<Assessment[]>('/oh/assessments');
  const { data: restrictions, reload: reloadR } = useFetch<SourceRestriction[]>('/oh/restrictions');
  const { data: types } = useFetch<CType[]>('/oh/constraint-types');
  const { data: trail } = useFetch<any[]>('/oh/access-trail');
  const { data: pending, reload: reloadPending } = useFetch<any[]>('/oh/capacity/pending');
  const { data: encryption } = useFetch<any>('/oh/encryption-status');

  const [newA, setNewA] = useState(false);
  const [newR, setNewR] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const nameFor = (id: number) => {
    const e = staff?.find((s) => s.id === id);
    return e ? `${e.firstName} ${e.lastName}` : `Employee ${id}`;
  };

  const [aForm, setAForm] = useState({
    employeeRef: 0, assessmentDate: todayKey(), fitnessStatus: 'FIT_WITH_RESTRICTIONS',
    clinicalNotes: '', diagnosisCode: '', reviewDate: addDays(todayKey(), 60),
  });
  const [rForm, setRForm] = useState({
    employeeRef: 0, assessmentId: 0, restrictionType: 'MAX_DAILY_HOURS',
    hours: 7.5, days: 5, weight: 1, durationMinutes: 20, everyHours: 4,
    effectiveFrom: todayKey(), effectiveTo: addDays(todayKey(), 60),
  });

  const createAssessment = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/oh/assessments', { ...aForm, employeeRef: Number(aForm.employeeRef) });
      setNewA(false); reloadA(); setFlash('Assessment recorded in the restricted zone.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const paramsFor = () => {
    switch (rForm.restrictionType) {
      case 'MAX_DAILY_HOURS':
      case 'MAX_WEEKLY_HOURS':
      case 'MIN_REST_HOURS':   return { hours: Number(rForm.hours) };
      case 'MAX_CONSECUTIVE_DAYS': return { days: Number(rForm.days) };
      case 'MAX_DAILY_WORKLOAD':   return { weight: Number(rForm.weight) };
      case 'REQUIRES_SCHEDULED_BREAKS':
        return { everyHours: Number(rForm.everyHours), durationMinutes: Number(rForm.durationMinutes) };
      default: return {};
    }
  };

  const createRestriction = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<any>('/oh/restrictions', {
        employeeRef: Number(rForm.employeeRef), assessmentId: Number(rForm.assessmentId),
        restrictionType: rForm.restrictionType, params: paramsFor(),
        effectiveFrom: rForm.effectiveFrom, effectiveTo: rForm.effectiveTo || null,
      });
      setNewR(false); reloadR();
      setFlash(`${r.message} ${r.firewall.projected} constraint(s) projected.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const revoke = async (id: number) => { await api.post(`/oh/restrictions/${id}/revoke`); reloadR(); };

  const empOptions = (staff ?? []).map((e) => (
    <option key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.empCode}</option>
  ));
  const needsHours = ['MAX_DAILY_HOURS', 'MAX_WEEKLY_HOURS', 'MIN_REST_HOURS'].includes(rForm.restrictionType);

  /* Anyone other than an occupational health officer gets a plain
   * explanation rather than an empty page. A blank screen looks like a bug
   * and invites someone to go looking for another way in. */
  if (assessmentsError) {
    return (
      <Page title="Occupational health"
            description="The restricted zone.">
        <Banner tone="restricted" title="This area is restricted to the occupational health team">
          Clinical records — assessments, diagnoses, notes and wellbeing responses — are
          reachable only by occupational health. Your attempt to open this page has been
          recorded in the audit trail, as every access and every refusal is.
          <br /><br />
          If you need to know whether a scheduling restriction applies to someone on your
          team, their profile under People shows the limit and the dates it covers.
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Occupational health"
          description="The restricted zone. Clinical records live here and nowhere else, and every action on this page is written to two independent logs."
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setNewA(true)}>Record assessment</Button>
              <Button variant="restricted" onClick={() => setNewR(true)}>Issue restriction</Button>
            </div>}>

      <Banner tone="restricted" title="You are inside the restricted zone">
        What you can see here — diagnosis codes, clinical notes, wellbeing responses —
        is not reachable by any other role, including HR and system administrators.
        When you issue a restriction, only its type, numeric parameters and dates
        cross the firewall.
      </Banner>

      {flash && <Banner tone="success" title="Done">{flash}</Banner>}

      {encryption?.enabled === false && (
        <Banner tone="error" title="Clinical data is not encrypted">
          HEALTH_ENCRYPTION_KEY is not set, so diagnoses and notes are being stored in plain
          text. Acceptable for a local demo, never for real records.
        </Banner>
      )}

      {(pending ?? []).length > 0 && (
        <Panel title="Self-declared limits awaiting your review" tone="restricted"
               description="Staff can state a limit on their own work without disclosing anything medical. These apply to the roster already and expire on the date shown unless you confirm them.">
          <Table>
            <thead><tr><TH>Staff member</TH><TH>Limit</TH><TH>Expires</TH><TH>Their note</TH><TH /></tr></thead>
            <tbody>
              {pending!.map((p) => (
                <tr key={p.id}>
                  <TD className="font-medium">{nameFor(p.employeeRef)}</TD>
                  <TD><span className="text-[13px]">{p.restrictionType}</span>
                      <span className="block text-[11.5px] text-ink-50 num">{JSON.stringify(p.params)}</span></TD>
                  <TD className="num text-[12.5px]">{p.effectiveTo ? shortDate(p.effectiveTo) : '—'}</TD>
                  <TD className="text-[12.5px] text-ink-70 max-w-[32ch]">
                    {p.employeeNote ?? <span className="text-ink-50">none given</span>}
                  </TD>
                  <TD align="right">
                    <Button size="sm" variant="restricted" onClick={async () => {
                      const r = await api.post<any>(`/oh/capacity/${p.id}/verify`, {});
                      setFlash(r.message); reloadPending(); reloadR();
                    }}>Confirm</Button>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 py-3 border-t border-restricted/20 text-[12px] text-ink-70">
            Confirming extends the limit to six months and records you as the authorising officer.
            It does not require an assessment — you may simply be agreeing that what the employee
            told you about their own work is reasonable.
          </p>
        </Panel>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
        <div className="bg-surface"><Metric label="Assessments on file" value={assessments?.length ?? 0} tone="restricted" /></div>
        <div className="bg-surface"><Metric label="Active restrictions" tone="restricted"
          value={(restrictions ?? []).filter((r) => r.status === 'ACTIVE').length}
          sub={`${(restrictions ?? []).filter((r) => r.projectedAt).length} projected to the scheduler`} /></div>
        <div className="bg-surface"><Metric label="Access events logged" value={trail?.length ?? 0}
          sub="every read and write, including refusals" /></div>
        <div className="bg-surface"><Metric label="Awaiting your review" value={(pending ?? []).length}
          tone={(pending ?? []).length ? 'amber' : undefined}
          sub="self-declared limits" /></div>
      </div>

      <Panel title="Work restrictions" tone="restricted"
             description="The authorised source. The scheduler only ever sees the projection.">
        {!restrictions ? <div className="py-12 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : restrictions.length === 0 ? <Empty title="No restrictions issued"
              action={<Button size="sm" variant="restricted" onClick={() => setNewR(true)}>Issue a restriction</Button>} />
          : (
            <Table>
              <thead><tr><TH>Staff member</TH><TH>Restriction</TH><TH>Effective</TH>
                <TH>Projected</TH><TH>Status</TH><TH /></tr></thead>
              <tbody>
                {restrictions.map((r) => {
                  const expired = r.effectiveTo && r.effectiveTo < todayKey();
                  return (
                    <tr key={r.id}>
                      <TD className="font-medium">{nameFor(r.employeeRef)}</TD>
                      <TD><span className="text-[13px]">{r.restrictionType}</span>
                          <span className="block text-[11.5px] text-ink-50 num">{r.params}</span></TD>
                      <TD className="num text-[12.5px]">{shortDate(r.effectiveFrom)} – {r.effectiveTo ? shortDate(r.effectiveTo) : '—'}</TD>
                      <TD>{r.projectedAt ? <Badge tone="signal">Live</Badge> : <Badge>Not projected</Badge>}</TD>
                      <TD>{expired ? <Badge tone="amber">Past end date</Badge>
                        : <Badge tone={r.status === 'ACTIVE' ? 'restricted' : 'neutral'}>{r.status}</Badge>}</TD>
                      <TD align="right">{r.status === 'ACTIVE' &&
                        <Button size="sm" variant="secondary" onClick={() => revoke(r.id)}>Revoke</Button>}</TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      </Panel>

      <Panel title="Assessments" tone="restricted"
             description="Clinical content. Visible on this page only.">
        {!assessments || assessments.length === 0 ? <Empty title="No assessments recorded" /> : (
          <ul className="divide-y divide-ink-10/70">
            {assessments.map((a) => (
              <li key={a.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[13.5px] font-medium">{nameFor(a.employeeRef)}</span>
                  <Badge tone={a.fitnessStatus === 'FIT' ? 'signal' : 'restricted'}>
                    {a.fitnessStatus.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  <span className="text-[12px] text-ink-50 num">{fullDate(a.assessmentDate)}</span>
                  {a.diagnosisCode && <span className="text-[12px] num text-restricted-dark">ICD {a.diagnosisCode}</span>}
                </div>
                {a.clinicalNotes && (
                  <p className="mt-1.5 text-[12.5px] text-ink-70 leading-relaxed max-w-[86ch]">{a.clinicalNotes}</p>
                )}
                <p className="mt-1 text-[11.5px] text-ink-50">
                  Assessed by {a.assessedBy}{a.reviewDate && ` · review due ${shortDate(a.reviewDate)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Access to the restricted zone" description="The health store keeps its own log, independent of the main audit trail.">
        {!trail || trail.length === 0 ? <Empty title="No access recorded yet" /> : (
          <Table>
            <thead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Subject</TH><TH>Outcome</TH></tr></thead>
            <tbody>
              {trail.slice(0, 25).map((t) => (
                <tr key={t.id}>
                  <TD className="num text-[12.5px]">{stamp(t.at)}</TD>
                  <TD className="text-[12.5px]">{t.actorEmail}<span className="block text-[11px] text-ink-50">{t.actorRole}</span></TD>
                  <TD className="text-[12.5px] num">{t.action}</TD>
                  <TD className="text-[12.5px]">{t.employeeRef ? nameFor(t.employeeRef) : '—'}</TD>
                  <TD><Badge tone={t.outcome === 'SUCCESS' ? 'signal' : 'alert'}>{t.outcome}</Badge></TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ── Record assessment ───────────────────────────────────────────── */}
      <Modal open={newA} onClose={() => setNewA(false)} title="Record an assessment">
        <div className="px-5 py-4 space-y-4">
          <div><Label htmlFor="ae">Employee</Label>
            <Select id="ae" value={aForm.employeeRef} onChange={(e) => setAForm({ ...aForm, employeeRef: Number(e.target.value) })}>
              <option value={0}>Select a staff member</option>{empOptions}
            </Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="ad">Assessment date</Label>
              <Input id="ad" type="date" value={aForm.assessmentDate} onChange={(e) => setAForm({ ...aForm, assessmentDate: e.target.value })} /></div>
            <div><Label htmlFor="ar">Review due</Label>
              <Input id="ar" type="date" value={aForm.reviewDate} onChange={(e) => setAForm({ ...aForm, reviewDate: e.target.value })} /></div>
          </div>
          <div><Label htmlFor="af">Fitness status</Label>
            <Select id="af" value={aForm.fitnessStatus} onChange={(e) => setAForm({ ...aForm, fitnessStatus: e.target.value })}>
              <option value="FIT">Fit</option>
              <option value="FIT_WITH_RESTRICTIONS">Fit with restrictions</option>
              <option value="TEMPORARILY_UNFIT">Temporarily unfit</option>
            </Select></div>
          <div><Label htmlFor="ac">Diagnosis code (optional)</Label>
            <Input id="ac" value={aForm.diagnosisCode} placeholder="ICD-10, e.g. M54.5"
                   onChange={(e) => setAForm({ ...aForm, diagnosisCode: e.target.value })} /></div>
          <div><Label htmlFor="an">Clinical notes</Label>
            <Textarea id="an" rows={3} value={aForm.clinicalNotes}
                      onChange={(e) => setAForm({ ...aForm, clinicalNotes: e.target.value })} /></div>
          <Banner tone="restricted">Stored in the health database only. No other role can read this.</Banner>
          {err && <Banner tone="error" title="Not saved">{err}</Banner>}
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setNewA(false)}>Cancel</Button>
          <Button variant="restricted" onClick={createAssessment} loading={busy}
                  disabled={!aForm.employeeRef}>Record assessment</Button>
        </footer>
      </Modal>

      {/* ── Issue restriction ───────────────────────────────────────────── */}
      <Modal open={newR} onClose={() => setNewR(false)} title="Issue a work restriction">
        <div className="px-5 py-4 space-y-4">
          <div><Label htmlFor="re">Employee</Label>
            <Select id="re" value={rForm.employeeRef}
                    onChange={(e) => setRForm({ ...rForm, employeeRef: Number(e.target.value), assessmentId: 0 })}>
              <option value={0}>Select a staff member</option>{empOptions}
            </Select></div>
          <div><Label htmlFor="ra">Based on assessment</Label>
            <Select id="ra" value={rForm.assessmentId} onChange={(e) => setRForm({ ...rForm, assessmentId: Number(e.target.value) })}>
              <option value={0}>Select an assessment</option>
              {(assessments ?? []).filter((a) => a.employeeRef === Number(rForm.employeeRef)).map((a) => (
                <option key={a.id} value={a.id}>{fullDate(a.assessmentDate)} — {a.fitnessStatus.replace(/_/g, ' ').toLowerCase()}</option>
              ))}
            </Select>
            {rForm.employeeRef > 0 && (assessments ?? []).filter((a) => a.employeeRef === Number(rForm.employeeRef)).length === 0 && (
              <p className="text-[11.5px] text-amber mt-1.5">Record an assessment for this person first.</p>
            )}
          </div>
          <div><Label htmlFor="rt">Restriction</Label>
            <Select id="rt" value={rForm.restrictionType} onChange={(e) => setRForm({ ...rForm, restrictionType: e.target.value })}>
              {(types ?? []).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
            <p className="text-[11.5px] text-ink-70 mt-1.5">
              A closed list of ten. There is no free-text option, which is what makes a
              diagnosis impossible to pass through by accident.
            </p>
          </div>

          {needsHours && (
            <div><Label htmlFor="rh">Hours</Label>
              <Input id="rh" type="number" step="0.5" min="0.5" value={rForm.hours}
                     onChange={(e) => setRForm({ ...rForm, hours: Number(e.target.value) })} /></div>
          )}
          {rForm.restrictionType === 'MAX_CONSECUTIVE_DAYS' && (
            <div><Label htmlFor="rd">Days</Label>
              <Input id="rd" type="number" min="1" value={rForm.days}
                     onChange={(e) => setRForm({ ...rForm, days: Number(e.target.value) })} /></div>
          )}
          {rForm.restrictionType === 'MAX_DAILY_WORKLOAD' && (
            <div><Label htmlFor="rw">Maximum workload weight</Label>
              <Input id="rw" type="number" step="0.1" min="0.1" value={rForm.weight}
                     onChange={(e) => setRForm({ ...rForm, weight: Number(e.target.value) })} /></div>
          )}
          {rForm.restrictionType === 'REQUIRES_SCHEDULED_BREAKS' && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="rb1">Every (hours)</Label>
                <Input id="rb1" type="number" step="0.5" value={rForm.everyHours}
                       onChange={(e) => setRForm({ ...rForm, everyHours: Number(e.target.value) })} /></div>
              <div><Label htmlFor="rb2">For (minutes)</Label>
                <Input id="rb2" type="number" value={rForm.durationMinutes}
                       onChange={(e) => setRForm({ ...rForm, durationMinutes: Number(e.target.value) })} /></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="rf">Effective from</Label>
              <Input id="rf" type="date" value={rForm.effectiveFrom} onChange={(e) => setRForm({ ...rForm, effectiveFrom: e.target.value })} /></div>
            <div><Label htmlFor="rto">Review / end date</Label>
              <Input id="rto" type="date" value={rForm.effectiveTo} onChange={(e) => setRForm({ ...rForm, effectiveTo: e.target.value })} /></div>
          </div>

          <Banner tone="info" title="What will cross the firewall">
            <span className="num text-[12px]">
              {JSON.stringify({ type: rForm.restrictionType, params: paramsFor(), from: rForm.effectiveFrom, to: rForm.effectiveTo })}
            </span>
          </Banner>
          {err && <Banner tone="error" title="Not issued">{err}</Banner>}
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setNewR(false)}>Cancel</Button>
          <Button variant="restricted" onClick={createRestriction} loading={busy}
                  disabled={!rForm.employeeRef || !rForm.assessmentId}>Issue restriction</Button>
        </footer>
      </Modal>
    </Page>
  );
}
