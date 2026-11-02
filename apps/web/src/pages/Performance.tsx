import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useAuth, useCan } from '../hooks/useAuth';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Table, TH, TD, Empty, Spinner, Modal,
  Label, Textarea, Select, Metric, Bar,
} from '../components/ui';
import { hrs, shortDate } from '../lib/format';
import type { Employee } from '../lib/types';

interface Competency { code: string; label: string; description: string }
interface Cycle { id: number; name: string; periodStart: string; periodEnd: string; status: string }
interface GoalScore {
  goalId: number; title: string; unit: string | null; target: number | null; actual: number | null;
  hoursWorked: number; ratePerHour: number | null; targetRatePerHour: number | null;
  attainmentPct: number | null; basis: string;
}
interface Review {
  id: number; employeeId: number; cycleId: number; ratings: Record<string, number>;
  overallRating: number | null; strengths: string | null; development: string | null;
  status: string; guardFlags: Array<{ phrase: string; field: string; note: string }>;
  employeeComment: string | null;
}

export default function Performance() {
  const { me } = useAuth();
  const can = useCan();
  const { data: cycles } = useFetch<Cycle[]>('/portal/performance/cycles');
  const { data: comps } = useFetch<Competency[]>('/portal/performance/competencies');
  const { data: staff } = useFetch<Employee[]>(can.canSeeDirectory ? '/hr/employees' : null);
  const cycle = cycles?.[0];

  const [target, setTarget] = useState<number | null>(null);
  const subject = can.canSeeDirectory ? target : me?.employeeId ?? null;

  const { data: scores } = useFetch<GoalScore[]>(
    subject && cycle ? `/portal/performance/score/${subject}/${cycle.id}` : null, [subject, cycle?.id]);
  const { data: review, reload: reloadReview } = useFetch<Review | null>(
    subject && cycle ? `/portal/performance/reviews/${subject}/${cycle.id}` : null, [subject, cycle?.id]);

  const [open, setOpen] = useState(false);

  if (!cycle) {
    return <Page title="Performance"><Panel><Empty title="No review cycle open">
      HR opens a cycle before reviews can be written.</Empty></Panel></Page>;
  }

  return (
    <Page title="Performance"
          description={`${cycle.name}. Measured goals are scored per hour worked, so a reduced-hours accommodation can never lower a score.`}
          actions={can.canSeeDirectory && (
            <div className="flex gap-2">
              <Select value={target ?? ''} onChange={(e) => setTarget(Number(e.target.value) || null)}
                      className="h-10 w-56 text-[13px]">
                <option value="">Choose a staff member</option>
                {(staff ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.firstName} {s.lastName} — {s.empCode}</option>
                ))}
              </Select>
              <Button disabled={!subject} onClick={() => setOpen(true)}>
                {review ? 'Edit review' : 'Write review'}
              </Button>
            </div>
          )}>

      <Banner tone="restricted" title="What a review may and may not consider">
        Ratings use a closed list of eight competencies. Hours, availability, attendance and
        shift pattern are not on it and cannot be added, because rating someone on those is
        rating them on a scheduling restriction. Narrative fields are scanned for the same
        thing and flagged where the employee can see it.
      </Banner>

      {!subject && can.canSeeDirectory && (
        <Panel><Empty title="Choose a staff member">
          Pick someone above to see their goal attainment and review.</Empty></Panel>
      )}

      {subject && (
        <>
          <Panel title="Goal attainment"
                 description="Every measured goal is converted to a rate per hour worked and compared against the same per-hour target for everyone.">
            {!scores ? <div className="py-12 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
              : scores.length === 0 ? <Empty title="No goals set for this cycle" />
              : (
                <Table>
                  <thead><tr>
                    <TH>Goal</TH><TH align="right">Achieved</TH><TH align="right">Hours worked</TH>
                    <TH align="right">Rate per hour</TH><TH align="right">Target rate</TH>
                    <TH align="right">Attainment</TH><TH className="w-[18%]" />
                  </tr></thead>
                  <tbody>
                    {scores.map((g) => (
                      <tr key={g.goalId}>
                        <TD>
                          <span className="font-medium">{g.title}</span>
                          <span className="block text-[11.5px] text-ink-50 max-w-[46ch]">{g.basis}</span>
                        </TD>
                        <TD align="right"><span className="num">{g.actual ?? '—'}{g.unit ? '' : ''}</span></TD>
                        <TD align="right"><span className="num">{g.hoursWorked ? hrs(g.hoursWorked) : '—'}</span></TD>
                        <TD align="right"><span className="num">{g.ratePerHour ?? '—'}</span></TD>
                        <TD align="right"><span className="num text-ink-70">{g.targetRatePerHour ?? '—'}</span></TD>
                        <TD align="right">
                          {g.attainmentPct == null ? <span className="text-ink-50">narrative</span>
                            : <span className={`num font-semibold ${g.attainmentPct >= 100 ? 'text-signal-dark' : 'text-amber'}`}>
                                {g.attainmentPct}%</span>}
                        </TD>
                        <TD>{g.attainmentPct != null && <Bar value={Math.min(150, g.attainmentPct)} max={150}
                          tone={g.attainmentPct >= 100 ? 'signal' : 'amber'} />}</TD>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
          </Panel>

          <Panel title="Review"
                 actions={review?.status === 'SUBMITTED' && subject === me?.employeeId
                   ? <Button size="sm" onClick={async () => {
                       await api.post(`/portal/performance/reviews/${review.id}/acknowledge`, {});
                       reloadReview();
                     }}>Acknowledge</Button>
                   : undefined}>
            {!review ? <Empty title="No review written yet">
              {can.canSeeDirectory ? 'Write one from the button above.' : 'Your manager has not written your review for this cycle yet.'}
            </Empty> : (
              <div className="px-5 py-4 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={review.status === 'ACKNOWLEDGED' ? 'signal' : review.status === 'SUBMITTED' ? 'amber' : 'neutral'}>
                    {review.status.toLowerCase()}
                  </Badge>
                  {review.overallRating != null && (
                    <span className="text-[13px]">Overall <span className="num font-semibold text-[16px]">{review.overallRating}</span> / 5</span>
                  )}
                </div>

                {review.guardFlags.length > 0 && (
                  <Banner tone="warn" title={`${review.guardFlags.length} fairness flag(s) on this review`}>
                    <ul className="mt-1 space-y-1">
                      {review.guardFlags.map((f, i) => (
                        <li key={i}>
                          “{f.phrase}” in {f.field} — {f.note}
                        </li>
                      ))}
                    </ul>
                  </Banner>
                )}

                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                  {(comps ?? []).map((c) => (
                    <div key={c.code} className="flex items-baseline justify-between gap-3 border-b border-ink-10/60 py-1.5">
                      <dt className="text-[13px]">{c.label}</dt>
                      <dd className="num font-semibold">{review.ratings[c.code] ?? '—'}</dd>
                    </div>
                  ))}
                </dl>

                {review.strengths && (
                  <div><p className="text-[12px] font-semibold text-ink-70 mb-1">Strengths</p>
                    <p className="text-[13px] leading-relaxed max-w-[76ch]">{review.strengths}</p></div>
                )}
                {review.development && (
                  <div><p className="text-[12px] font-semibold text-ink-70 mb-1">Development</p>
                    <p className="text-[13px] leading-relaxed max-w-[76ch]">{review.development}</p></div>
                )}
                {review.employeeComment && (
                  <div><p className="text-[12px] font-semibold text-ink-70 mb-1">Employee comment</p>
                    <p className="text-[13px] leading-relaxed max-w-[76ch]">{review.employeeComment}</p></div>
                )}
              </div>
            )}
          </Panel>
        </>
      )}

      {can.canSeeDirectory && subject && comps && (
        <ReviewForm open={open} onClose={() => setOpen(false)} competencies={comps}
                    cycleId={cycle.id} employeeId={subject} existing={review}
                    onSaved={() => { setOpen(false); reloadReview(); }} />
      )}
    </Page>
  );
}

function ReviewForm({ open, onClose, competencies, cycleId, employeeId, existing, onSaved }: {
  open: boolean; onClose: () => void; competencies: Competency[];
  cycleId: number; employeeId: number; existing: Review | null; onSaved: () => void;
}) {
  const [ratings, setRatings] = useState<Record<string, number>>(existing?.ratings ?? {});
  const [strengths, setStrengths] = useState(existing?.strengths ?? '');
  const [development, setDevelopment] = useState(existing?.development ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [flags, setFlags] = useState<Review['guardFlags']>([]);
  const [busy, setBusy] = useState(false);

  const save = async (submit: boolean) => {
    setBusy(true); setErr(null); setFlags([]);
    try {
      const r = await api.post<any>('/portal/performance/reviews', {
        cycleId, employeeId, ratings, strengths, development, submit,
      });
      if (r.flags?.length) setFlags(r.flags);
      else onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Write review" width="max-w-2xl">
      <div className="px-5 py-4 space-y-4">
        <p className="text-[13px] text-ink-70">Rate from 1 (needs significant support) to 5 (consistently excellent).</p>
        <div className="space-y-2">
          {competencies.map((c) => (
            <div key={c.code} className="flex items-center justify-between gap-4 py-1.5 border-b border-ink-10/60">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{c.label}</p>
                <p className="text-[11.5px] text-ink-70 max-w-[52ch]">{c.description}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRatings({ ...ratings, [c.code]: n })}
                    className={`h-8 w-8 rounded-[4px] text-[13px] num border transition-colors ${
                      ratings[c.code] === n ? 'bg-signal text-white border-signal'
                        : 'bg-white border-ink-30 text-ink-70 hover:border-signal/50'}`}>{n}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div><Label htmlFor="st">Strengths</Label>
          <Textarea id="st" rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)}
                    placeholder="What this person does well, in terms of the work itself." /></div>
        <div><Label htmlFor="dv">Development</Label>
          <Textarea id="dv" rows={3} value={development} onChange={(e) => setDevelopment(e.target.value)}
                    placeholder="What would help them develop, in terms of the work itself." /></div>

        <Banner tone="info">
          Comment on the quality of the work, not on how many hours someone was available.
          Phrases about availability, hours or health are flagged automatically and shown to
          the employee.
        </Banner>

        {flags.length > 0 && (
          <Banner tone="warn" title={`${flags.length} phrase(s) flagged — review saved with the flags attached`}>
            <ul className="mt-1 space-y-1">
              {flags.map((f, i) => <li key={i}>“{f.phrase}” in {f.field}</li>)}
            </ul>
            <p className="mt-2">Reword and save again, or close if you intend the flags to stand.</p>
          </Banner>
        )}
        {err && <Banner tone="error" title="Not saved">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" onClick={() => save(false)} loading={busy}>Save draft</Button>
        <Button onClick={() => save(true)} loading={busy}>Submit review</Button>
      </footer>
    </Modal>
  );
}
