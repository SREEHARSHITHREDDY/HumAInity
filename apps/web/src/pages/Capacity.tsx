import { useState } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { api } from '../lib/api';
import {
  Panel, Button, Badge, Banner, Empty, Spinner, Modal, Label, Textarea, Select, Input,
} from '../components/ui';
import { fullDate, shortDate, todayKey } from '../lib/format';

interface Question {
  id: string; question: string; help?: string;
  options: Array<{ value: string; label: string }>;
}
interface Suggestion {
  constraintType: string; params: Record<string, number>; label: string; because: string;
}
interface Declaration {
  id: number; opaqueRef: string; restrictionType: string; params: Record<string, number>;
  effectiveFrom: string; effectiveTo: string | null; source: string; status: string;
  verifiedBy: string | null; verifiedAt: string | null;
  employeeNote: string | null; canWithdraw: boolean;
}

const TYPES = [
  { value: 'MAX_DAILY_HOURS',          label: 'A limit on how long a shift can be', field: 'hours', unit: 'hours' },
  { value: 'NO_NIGHT_SHIFTS',          label: 'Not rostered on night shifts' },
  { value: 'NO_WEEKEND_SHIFTS',        label: 'Not rostered at weekends' },
  { value: 'MIN_REST_HOURS',           label: 'A longer gap between shifts', field: 'hours', unit: 'hours' },
  { value: 'MAX_CONSECUTIVE_DAYS',     label: 'A limit on days in a row', field: 'days', unit: 'days' },
  { value: 'MAX_WEEKLY_HOURS',         label: 'A limit on hours per week', field: 'hours', unit: 'hours' },
];

export default function Capacity() {
  const { data: questionsResp } = useFetch<{ questions: Question[]; note: string }>('/oh/capacity/questions');
  const { data: mine, reload } = useFetch<Declaration[]>('/oh/capacity/mine');

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestNote, setSuggestNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const questions = questionsResp?.questions ?? [];
  const answered = Object.keys(answers).length;

  const getSuggestions = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ suggestions: Suggestion[]; note: string }>('/oh/capacity/suggest', { answers });
      setSuggestions(r.suggestions); setSuggestNote(r.note);
    } finally { setBusy(false); }
  };

  const declare = async (s: Suggestion) => {
    const r = await api.post<any>('/oh/capacity/declare', {
      restrictionType: s.constraintType, params: s.params,
    });
    setFlash(r.message);
    setSuggestions((cur) => (cur ?? []).filter((x) => x.constraintType !== s.constraintType));
    reload();
  };

  const withdraw = async (d: Declaration) => {
    const r = await api.post<any>(`/oh/capacity/${d.id}/withdraw`);
    setFlash(r.message); reload();
  };

  const active = (mine ?? []).filter((d) => d.status === 'ACTIVE');

  return (
    <Page title="Work capacity"
          description="Tell the roster what you can manage. You never have to say why."
          actions={<Button variant="secondary" onClick={() => setManual(true)}>Declare a limit directly</Button>}>

      <Banner tone="restricted" title="You are not being asked about your health">
        Every question below is about your work — how long you can work, whether nights are
        manageable, how much rest you need. No condition, symptom, medication or diagnosis is
        asked for, and there is nowhere in this form to enter one. Your manager will see the
        limit and the dates, never that you set it yourself and never a reason.
      </Banner>

      {flash && <Banner tone="success" title="Done">{flash}</Banner>}

      {active.length > 0 && (
        <Panel title="What currently applies to you">
          <ul className="divide-y divide-ink-10/70">
            {active.map((d) => {
              const provisional = d.source === 'SELF_DECLARED';
              return (
                <li key={d.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">
                      {describe(d.restrictionType, d.params)}
                    </p>
                    <p className="text-[12px] text-ink-70 mt-0.5 num">
                      {fullDate(d.effectiveFrom)} → {d.effectiveTo ? fullDate(d.effectiveTo) : 'no end date'}
                    </p>
                    {d.employeeNote && (
                      <p className="text-[12px] text-ink-50 mt-1 italic">Your note: {d.employeeNote}</p>
                    )}
                    {provisional && (
                      <p className="text-[11.5px] text-amber mt-1.5 leading-snug max-w-[70ch]">
                        Provisional. It applies to your roster now, and expires on the review date
                        unless occupational health confirms it or you declare it again.
                      </p>
                    )}
                    {d.verifiedBy && (
                      <p className="text-[11.5px] text-signal-dark mt-1.5">
                        Confirmed by occupational health on {shortDate(d.verifiedAt!)}.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={provisional ? 'amber' : 'signal'}>
                      {provisional ? 'self-declared' : 'confirmed'}
                    </Badge>
                    {d.canWithdraw && (
                      <Button size="sm" variant="secondary" onClick={() => withdraw(d)}>Withdraw</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="px-5 py-3 border-t border-ink-10 text-[12px] text-ink-70">
            You can withdraw anything you declared yourself, at any time, without giving a reason.
            A limit set by occupational health can only be changed by them.
          </p>
        </Panel>
      )}

      <Panel title="Work capacity check"
             description={questionsResp?.note}>
        <div className="px-5 py-4 space-y-5">
          {questions.map((q) => (
            <fieldset key={q.id}>
              <legend className="text-[13.5px] font-medium">{q.question}</legend>
              {q.help && <p className="text-[12px] text-ink-70 mt-0.5 mb-2">{q.help}</p>}
              <div className={`flex flex-wrap gap-1.5 ${q.help ? '' : 'mt-2'}`}>
                {q.options.map((o) => (
                  <button key={o.value} type="button"
                    onClick={() => setAnswers({ ...answers, [q.id]: o.value })}
                    className={`px-3 h-9 rounded-[4px] text-[12.5px] border transition-colors ${
                      answers[q.id] === o.value
                        ? 'bg-ink text-white border-ink'
                        : 'bg-white border-ink-30 text-ink-70 hover:border-ink'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={getSuggestions} loading={busy}
                    disabled={answered < questions.length}>
              See what this suggests
            </Button>
            <span className="text-[12.5px] text-ink-70">
              {answered} of {questions.length} answered
            </span>
          </div>
        </div>
      </Panel>

      {suggestions && (
        <Panel title="Suggested limits"
               description="Drawn from your own answers. Nothing is applied until you choose it.">
          {suggestions.length === 0 ? (
            <Empty title="Nothing suggested">{suggestNote}</Empty>
          ) : (
            <>
              <ul className="divide-y divide-ink-10/70">
                {suggestions.map((s) => (
                  <li key={s.constraintType} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium">{s.label}</p>
                      <p className="text-[12px] text-ink-70 mt-0.5 italic">{s.because}</p>
                    </div>
                    <Button size="sm" onClick={() => declare(s)}>Apply this</Button>
                  </li>
                ))}
              </ul>
              <p className="px-5 py-3 border-t border-ink-10 text-[12px] text-ink-70">{suggestNote}</p>
            </>
          )}
        </Panel>
      )}

      {manual && <ManualDeclare onClose={() => setManual(false)}
                                onDone={(m) => { setManual(false); setFlash(m); reload(); }} />}
    </Page>
  );
}

function describe(type: string, params: Record<string, number>): string {
  switch (type) {
    case 'MAX_DAILY_HOURS':      return `Maximum ${params.hours} hours per day`;
    case 'MAX_WEEKLY_HOURS':     return `Maximum ${params.hours} hours per week`;
    case 'MIN_REST_HOURS':       return `At least ${params.hours} hours rest between shifts`;
    case 'MAX_CONSECUTIVE_DAYS': return `Maximum ${params.days} consecutive working days`;
    case 'NO_NIGHT_SHIFTS':      return 'Not rostered on night shifts';
    case 'NO_WEEKEND_SHIFTS':    return 'Not rostered at weekends';
    case 'MAX_DAILY_WORKLOAD':   return 'Lower-intensity shifts';
    case 'REQUIRES_SCHEDULED_BREAKS':
      return `A ${params.durationMinutes}-minute break every ${params.everyHours} hours`;
    default: return type;
  }
}

function ManualDeclare({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [type, setType] = useState('MAX_DAILY_HOURS');
  const [value, setValue] = useState(6);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = TYPES.find((t) => t.value === type)!;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const params = chosen.field ? { [chosen.field]: Number(value) } : {};
      const r = await api.post<any>('/oh/capacity/declare', {
        restrictionType: type, params, employeeNote: note || undefined,
      });
      onDone(r.message);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Declare a limit on your work">
      <div className="px-5 py-4 space-y-4">
        <div>
          <Label htmlFor="ct">What do you need?</Label>
          <Select id="ct" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>

        {chosen.field && (
          <div>
            <Label htmlFor="cv">Number of {chosen.unit}</Label>
            <Input id="cv" type="number" step="0.5" min="1" value={value}
                   onChange={(e) => setValue(Number(e.target.value))} />
          </div>
        )}

        <div>
          <Label htmlFor="cn">A note for occupational health (optional)</Label>
          <Textarea id="cn" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Anything you want them to know. Entirely optional." />
          <p className="text-[11.5px] text-ink-70 mt-1.5 leading-snug">
            Only occupational health and you can ever read this. It is encrypted, and it is
            never shown to your manager or sent to the scheduler. You do not have to write
            anything, and you should not feel you need to explain yourself.
          </p>
        </div>

        <Banner tone="info" title="What happens next">
          The scheduler applies this from your next roster. It lasts 30 days, then expires unless
          occupational health confirms it or you declare it again. You can withdraw it at any time.
        </Banner>

        {err && <Banner tone="error" title="Not applied">{err}</Banner>}
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-ink-10">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy}>Apply this limit</Button>
      </footer>
    </Modal>
  );
}
