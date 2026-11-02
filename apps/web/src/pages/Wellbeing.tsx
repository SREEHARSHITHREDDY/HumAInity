import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { Panel, Button, Banner, Metric, Bar, Badge, Empty, Label, Select } from '../components/ui';
import { hrs } from '../lib/format';
import type { Fatigue, Capacity } from '../lib/types';

const QUESTIONS = [
  ['rested', 'How rested do you feel at the start of a shift?'],
  ['workload', 'How manageable has your workload been?'],
  ['recovery', 'How well are you recovering between shifts?'],
  ['support', 'How supported do you feel by your team?'],
];
const SCALE = [
  [1, 'Very good'], [2, 'Good'], [3, 'Mixed'], [4, 'Poor'], [5, 'Very poor'],
] as const;

export default function Wellbeing() {
  const { me } = useAuth();
  const id = me?.employeeId;
  const { data: f } = useFetch<Fatigue>(id ? `/workforce/fatigue/${id}` : null);
  const { data: cap, reload: reloadCap } = useFetch<Capacity>(id ? `/workforce/capacity/${id}` : null);

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);
  const [optErr, setOptErr] = useState<string | null>(null);
  const [extra, setExtra] = useState(8);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<any>('/oh/check-ins', { responses: answers });
      setSent(r.message); setAnswers({});
    } finally { setBusy(false); }
  };

  const optIn = async () => {
    setOptBusy(true); setOptErr(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 27 * 86400000).toISOString().slice(0, 10);
      await api.post('/workforce/overtime/opt-in', {
        periodStart: today, periodEnd: end, maxAdditionalHours: extra,
      });
      reloadCap();
    } catch (e) { setOptErr((e as Error).message); } finally { setOptBusy(false); }
  };

  const band = f?.band ?? 'OK';
  const tone = band === 'CRITICAL' ? 'alert' : band === 'OK' ? 'signal' : 'amber';

  return (
    <Page title="Wellbeing" description="Your workload, your limits, and a private check-in that only occupational health can read.">
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Your workload" description="Built from hours, nights and rest gaps. No health information is used.">
          {!f ? <Empty title="No workload data yet" /> : (
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[42px] leading-none font-semibold num">{f.score}</p>
                  <p className="text-[12px] text-ink-70 mt-1">out of 100</p>
                </div>
                <Badge tone={tone as any}>{band === 'OK' ? 'Within healthy limits' : band}</Badge>
              </div>
              <Bar value={f.score} max={100} tone={tone as any} />
              <div>
                <p className="text-[12px] font-semibold text-ink-70 mb-1">What is driving it</p>
                <ul className="space-y-1">{f.drivers.map((d) => (
                  <li key={d} className="text-[13px] text-ink-70 leading-snug">{d}</li>))}</ul>
              </div>
              <dl className="grid grid-cols-2 gap-y-1.5 text-[13px] pt-3 border-t border-ink-10">
                <dt className="text-ink-70">Hours this week</dt>
                <dd className="num text-right">{hrs(f.components.hoursLast7)} of {hrs(f.components.contractedWeeklyHours)}</dd>
                <dt className="text-ink-70">Consecutive days</dt><dd className="num text-right">{f.components.consecutiveDays}</dd>
                <dt className="text-ink-70">Nights, last fortnight</dt><dd className="num text-right">{f.components.nightsLast14}</dd>
                <dt className="text-ink-70">Short turnarounds</dt><dd className="num text-right">{f.components.shortRestCount}</dd>
              </dl>
              {f.atCeiling && (
                <Banner tone="error" title="You are at the fatigue ceiling">
                  Additional hours are closed to you until your score falls. This limit applies
                  to everyone and cannot be waived — including by you.
                </Banner>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Additional hours" description="Always your choice, and paid at the same premium for everyone.">
          <div className="px-5 py-4 space-y-4">
            {cap?.eligibleForVoluntaryExtra ? (
              <Banner tone="success" title="You are opted in">
                Up to {hrs(cap.voluntaryExtraCapHours)} of additional hours this period, paid at 1.5×.
              </Banner>
            ) : (
              <>
                <Banner tone="info" title="Not currently taking additional hours">
                  {cap?.blockedReason ?? 'You have not opted in.'} Your contracted hours are
                  paid in full regardless.
                </Banner>
                {cap?.blockedReason === 'Has not opted in to additional hours' && (
                  <>
                    <div>
                      <Label htmlFor="ex">Maximum additional hours you are willing to take</Label>
                      <Select id="ex" value={extra} onChange={(e) => setExtra(Number(e.target.value))}>
                        {[4, 6, 8, 10, 12].map((h) => <option key={h} value={h}>{h} hours</option>)}
                      </Select>
                    </div>
                    {optErr && <Banner tone="error" title="Could not opt in">{optErr}</Banner>}
                    <Button onClick={optIn} loading={optBusy}>Opt in to additional hours</Button>
                  </>
                )}
              </>
            )}
            <p className="text-[12px] text-ink-70 leading-relaxed pt-3 border-t border-ink-10">
              The scheduler only offers extra hours to people who have opted in and are below
              the fatigue ceiling. It never assigns them automatically.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Private check-in" tone="restricted"
             description="Four questions. Your answers go straight to occupational health and are never shown to your manager.">
        {sent ? (
          <div className="px-5 py-4">
            <Banner tone="success" title="Check-in submitted">{sent}</Banner>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSent(null)}>Submit another</Button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {QUESTIONS.map(([key, q]) => (
              <fieldset key={key}>
                <legend className="text-[13.5px] font-medium mb-2">{q}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {SCALE.map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setAnswers({ ...answers, [key]: v })}
                      className={`px-3 h-8 rounded-[4px] text-[12.5px] border transition-colors ${
                        answers[key] === v
                          ? 'bg-restricted text-white border-restricted'
                          : 'bg-white border-ink-30 text-ink-70 hover:border-restricted/50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <Banner tone="restricted">
              Stored in the restricted zone. If occupational health thinks a change to your
              roster would help, they can issue a restriction — and the scheduler will still
              only receive a limit, never your answers.
            </Banner>
            <Button variant="restricted" onClick={submit} loading={busy}
                    disabled={Object.keys(answers).length < QUESTIONS.length}>
              Submit check-in
            </Button>
          </div>
        )}
      </Panel>
    </Page>
  );
}
