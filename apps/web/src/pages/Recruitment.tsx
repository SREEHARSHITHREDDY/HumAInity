import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Table, TH, TD, Empty, Spinner, Modal,
  Label, Input, Textarea, Select, Metric,
} from '../components/ui';
import { money, shortDate } from '../lib/format';

interface Posting {
  id: number; reference: string; title: string; departmentName: string; facilityName: string;
  employmentType: string; openings: number; requiredQualifications: string[];
  desirableSkills: string[]; minYearsExperience: number;
  salaryRangeMin: number | null; salaryRangeMax: number | null;
  description: string; status: string; closingDate: string | null; applicants: number;
}
interface Evidence {
  requiredMet: Array<{ code: string; quote: string }>;
  requiredMissing: string[];
  desirableMet: Array<{ code: string; quote: string }>;
  experience: { stated: number; required: number; met: boolean };
  redactions: string[];
  explanation: string[];
}
interface AppRow {
  id: number; stage: string; matchScore: number | null; matchEvidence: Evidence;
  fullName: string; email: string; yearsExperience: number; resumeText: string;
  jobPostingId: number; jobTitle: string; jobReference: string; decisionNote: string | null;
}

const STAGES = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED'];
const stageTone = (s: string) =>
  s === 'HIRED' ? 'signal' : s === 'REJECTED' ? 'alert'
    : s === 'OFFERED' || s === 'INTERVIEWING' ? 'amber' : 'neutral';

export default function Recruitment() {
  const { data: postings, reload: reloadPostings } = useFetch<Posting[]>('/portal/recruitment/postings');
  const [job, setJob] = useState<number | null>(null);
  const current = job ?? postings?.[0]?.id ?? null;
  const { data: pipeline, reload } = useFetch<AppRow[]>(
    current ? `/portal/recruitment/pipeline?jobPostingId=${current}` : null, [current]);

  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AppRow | null>(null);
  const [decide, setDecide] = useState<AppRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const screenAll = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.post<any>(`/portal/recruitment/postings/${current}/screen-all`);
      setFlash(`${r.screened} application(s) screened. ${r.note}`);
      reload();
    } finally { setBusy(false); }
  };

  const posting = (postings ?? []).find((p) => p.id === current);

  return (
    <Page title="Recruitment"
          description="Screening produces a summary for a human reviewer. It cannot shortlist, reject or rank anyone out of the process."
          actions={
            <div className="flex gap-2">
              <Select value={current ?? ''} onChange={(e) => setJob(Number(e.target.value))}
                      className="h-10 w-64 text-[13px]">
                {(postings ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>
                ))}
              </Select>
              <Button onClick={screenAll} loading={busy} disabled={!current}>Screen applications</Button>
            </div>}>

      <Banner tone="restricted" title="What the screening tool is not allowed to do">
        It scores only against the qualifications and skills this posting states, and shows you
        where in each resume it found them. It never rejects anyone — only a person can do that,
        and the reason is recorded. If a resume volunteers health information, those lines are
        set aside and do not affect the score.
      </Banner>

      {flash && <Banner tone="success" title="Screening complete">{flash}</Banner>}

      {posting && (
        <div className="grid sm:grid-cols-4 gap-px bg-ink-10 border border-ink-10 rounded-card overflow-hidden">
          <div className="bg-surface"><Metric label="Openings" value={posting.openings}
            sub={`${posting.employmentType === 'FULL_TIME' ? 'Full time' : 'Part time'} · ${posting.departmentName}`} /></div>
          <div className="bg-surface"><Metric label="Applicants" value={posting.applicants} /></div>
          <div className="bg-surface"><Metric label="Required"
            value={<span className="text-[15px]">{posting.requiredQualifications.join(', ') || '—'}</span>}
            sub={`${posting.minYearsExperience}+ years experience`} /></div>
          <div className="bg-surface"><Metric label="Salary range"
            value={<span className="text-[15px]">{posting.salaryRangeMin ? `${money(posting.salaryRangeMin)}–${money(posting.salaryRangeMax ?? 0)}` : '—'}</span>}
            sub={posting.closingDate ? `Closes ${shortDate(posting.closingDate)}` : undefined} /></div>
        </div>
      )}

      <Panel title="Pipeline" description="Ordered by advisory score. Order is a convenience, not a decision.">
        {!pipeline ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : pipeline.length === 0 ? <Empty title="No applications yet" />
          : (
            <Table>
              <thead><tr>
                <TH>Candidate</TH><TH align="right">Experience</TH><TH align="right">Advisory score</TH>
                <TH>Requirements evidenced</TH><TH>Stage</TH><TH />
              </tr></thead>
              <tbody>
                {pipeline.map((a) => {
                  const e = a.matchEvidence;
                  const total = (e?.requiredMet?.length ?? 0) + (e?.requiredMissing?.length ?? 0);
                  return (
                    <tr key={a.id}>
                      <TD>
                        <span className="font-medium">{a.fullName}</span>
                        <span className="block text-[11.5px] text-ink-50">{a.email}</span>
                      </TD>
                      <TD align="right"><span className="num">{a.yearsExperience}y</span></TD>
                      <TD align="right">
                        {a.matchScore == null ? <span className="text-ink-50 text-[12.5px]">not screened</span>
                          : <span className="num font-semibold">{a.matchScore}</span>}
                      </TD>
                      <TD>
                        {total > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {e.requiredMet.map((m) => <Badge key={m.code} tone="signal">{m.code}</Badge>)}
                            {e.requiredMissing.map((m) => <Badge key={m} tone="alert">{m} missing</Badge>)}
                            {e.redactions?.length > 0 && <Badge tone="restricted">{e.redactions.length} line set aside</Badge>}
                          </span>
                        ) : <span className="text-ink-50 text-[12.5px]">—</span>}
                      </TD>
                      <TD><Badge tone={stageTone(a.stage) as any}>{a.stage.toLowerCase()}</Badge></TD>
                      <TD align="right">
                        <span className="flex gap-1.5 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setDetail(a)}>Evidence</Button>
                          <Button size="sm" variant="secondary" onClick={() => setDecide(a)}>Decide</Button>
                        </span>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      </Panel>

      {/* ── Evidence ─────────────────────────────────────────────────────── */}
      <Modal open={!!detail} onClose={() => setDetail(null)}
             title={detail ? `Screening evidence — ${detail.fullName}` : ''} width="max-w-2xl">
        {detail && (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[30px] leading-none font-semibold num">{detail.matchScore ?? '—'}</span>
              <span className="text-[13px] text-ink-70">advisory score</span>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-ink-70 mb-1.5">How it was reached</p>
              <ul className="space-y-1">
                {(detail.matchEvidence?.explanation ?? []).map((x, i) => (
                  <li key={i} className="text-[12.5px] text-ink-70 leading-snug">{x}</li>
                ))}
              </ul>
            </div>

            {detail.matchEvidence?.requiredMet?.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-ink-70 mb-1.5">Required qualifications found</p>
                <ul className="space-y-1.5">
                  {detail.matchEvidence.requiredMet.map((m) => (
                    <li key={m.code} className="text-[12.5px]">
                      <Badge tone="signal">{m.code}</Badge>
                      <span className="block mt-1 pl-2 border-l-2 border-signal/30 text-ink-70 italic">“{m.quote}”</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.matchEvidence?.desirableMet?.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-ink-70 mb-1.5">Desirable skills found</p>
                <ul className="space-y-1.5">
                  {detail.matchEvidence.desirableMet.map((m) => (
                    <li key={m.code} className="text-[12.5px]">
                      <Badge>{m.code}</Badge>
                      <span className="block mt-1 pl-2 border-l-2 border-ink-30 text-ink-70 italic">“{m.quote}”</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.matchEvidence?.redactions?.length > 0 && (
              <Banner tone="restricted" title="Set aside and not scored">
                <ul className="mt-1 space-y-1">
                  {detail.matchEvidence.redactions.map((r, i) => (
                    <li key={i} className="italic">“{r}”</li>
                  ))}
                </ul>
                <p className="mt-2">
                  These lines mention health. A candidate explaining a career gap must not have
                  that explanation turned into a scoring input, so they were excluded.
                </p>
              </Banner>
            )}

            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-ink-70 hover:text-ink">Full resume text</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-ink-70 leading-relaxed bg-paper p-3 rounded-[4px] border border-ink-10">
{detail.resumeText}</pre>
            </details>
          </div>
        )}
        <footer className="flex justify-end px-5 py-3.5 border-t border-ink-10">
          <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
        </footer>
      </Modal>

      {/* ── Decide ───────────────────────────────────────────────────────── */}
      {decide && <DecideModal app={decide} onClose={() => setDecide(null)}
                              onDone={() => { setDecide(null); reload(); }} />}
    </Page>
  );
}

function DecideModal({ app, onClose, onDone }: { app: AppRow; onClose: () => void; onDone: () => void }) {
  const [stage, setStage] = useState(app.stage);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsNote = ['REJECTED', 'OFFERED', 'HIRED'].includes(stage);

  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/portal/recruitment/applications/${app.id}/decide`, { stage, note }); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Decision — ${app.fullName}`}>
      <div className="px-5 py-4 space-y-4">
        <div><Label htmlFor="sg">Move to</Label>
          <Select id="sg" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select></div>
        <div>
          <Label htmlFor="nt">Reason{needsNote ? '' : ' (optional)'}</Label>
          <Textarea id="nt" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Why this decision was made." />
          {needsNote && (
            <p className="text-[11.5px] text-ink-70 mt-1.5">
              A decision that affects the candidate needs a recorded reason. This is kept in the
              audit trail against your name.
            </p>
          )}
        </div>
        {err && <Banner tone="error" title="Not saved">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy}>Record decision</Button>
      </footer>
    </Modal>
  );
}
