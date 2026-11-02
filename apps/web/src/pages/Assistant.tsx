import { useState, useRef, useEffect } from 'react';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { api } from '../lib/api';
import { Panel, Button, Badge, Banner, Input, Spinner } from '../components/ui';

interface Msg {
  id?: number; question: string; answer: string; sources: string[];
  refused: boolean; suggestions?: string[];
}

const STARTERS = [
  'When is my next shift?',
  'How much annual leave do I have left?',
  'Why can I not take extra hours?',
  'When does my BLS certificate expire?',
  'What is the policy on additional hours?',
];

export default function Assistant() {
  const { data: history, loading } = useFetch<Msg[]>('/portal/assistant/history');
  const [thread, setThread] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (history) setThread(history); }, [history]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.length]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ(''); setBusy(true);
    try {
      const r = await api.post<Msg>('/portal/assistant/ask', { question });
      setThread((t) => [...t, { ...r, question }]);
    } finally { setBusy(false); }
  };

  return (
    <Page title="Assistant"
          description="Answers about your own shifts, leave, pay, credentials and published policy.">

      <Banner tone="restricted" title="What it cannot do, by construction">
        There is no language model behind this. Every answer comes from a matched question and
        real rows, and the sources consulted are recorded on each reply. It has no connection to
        the occupational health store, so it cannot tell you why a restriction applies — to you
        or to anybody else — and it will say so plainly rather than guessing.
      </Banner>

      <Panel title="Conversation">
        <div className="px-5 py-4 space-y-4 max-h-[52vh] overflow-y-auto">
          {loading && <div className="py-8 grid place-items-center"><Spinner className="h-5 w-5 text-ink-50" /></div>}

          {!loading && thread.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-[13.5px] text-ink-70">Ask something to get started.</p>
            </div>
          )}

          {thread.map((m, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end">
                <p className="bg-ink text-white rounded-[6px] rounded-br-[2px] px-3.5 py-2 text-[13.5px] max-w-[70%]">
                  {m.question}
                </p>
              </div>
              <div className="flex justify-start">
                <div className={`rounded-[6px] rounded-bl-[2px] px-3.5 py-2.5 max-w-[80%] border ${
                  m.refused ? 'bg-restricted-tint border-restricted/30' : 'bg-paper border-ink-10'}`}>
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.answer}</p>
                  {m.sources?.length > 0 && (
                    <p className="mt-2 pt-2 border-t border-ink-10 flex flex-wrap gap-1 items-center">
                      <span className="text-[11px] text-ink-50">consulted:</span>
                      {m.sources.map((s) => (
                        <Badge key={s} tone={s.startsWith('refusal:') ? 'restricted' : 'neutral'}>{s}</Badge>
                      ))}
                    </p>
                  )}
                  {m.suggestions && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.suggestions.map((s) => (
                        <button key={s} onClick={() => send(s)}
                          className="text-[12px] px-2 py-1 rounded-[4px] border border-ink-30 hover:border-signal hover:text-signal">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="border-t border-ink-10 px-5 py-3.5">
          {thread.length === 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="text-[12.5px] px-2.5 py-1.5 rounded-[4px] border border-ink-30 hover:border-signal hover:text-signal transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500}
                   placeholder="Ask about your shifts, leave, pay or a policy" />
            <Button type="submit" loading={busy} disabled={!q.trim()}>Ask</Button>
          </form>
        </div>
      </Panel>
    </Page>
  );
}
