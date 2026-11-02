import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button, Input, Label, Banner } from '../components/ui';

const DEMO = [
  ['Priya Nair',      'Engineer, 7.5h daily cap',        'priya.nair@humainity.io'],
  ['Arjun Mehta',     'Engineer, 6h cap, no nights',     'arjun.mehta@humainity.io'],
  ['Sneha Reddy',     'Engineer, opted in to extra hours','sneha.reddy@humainity.io'],
  ['Harish Kumar',    'Roster planner',               'harish.kumar@humainity.io'],
  ['Shalini Rao',     'Line manager',                 'shalini.rao@humainity.io'],
  ['Deepak Sharma',   'HR admin',                     'deepak.sharma@humainity.io'],
  ['Anita Bose',      'Occupational health officer',  'anita.bose@humainity.io'],
  ['Geeta Krishnan',  'Compliance auditor',           'geeta.krishnan@humainity.io'],
];

export default function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('harish.kumar@humainity.io');
  const [password, setPassword] = useState('Demo@1234');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(email, password); nav('/'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_minmax(420px,480px)]">
      {/* The left panel states the product's one claim, in the product's voice. */}
      <section className="hidden lg:flex flex-col justify-between bg-ink text-white p-10 xl:p-14">
        <div className="flex items-center gap-3">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="6" fill="#ffffff14" />
            <path d="M9 10v12M9 16h7M16 10v12" stroke="#4FD1BC" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <rect x="20" y="13" width="5" height="6" rx="1.5" fill="#B795E8" />
          </svg>
          <p className="text-[17px] font-semibold tracking-tight">HumAInity</p>
        </div>

        <div className="max-w-[30ch]">
          <h1 className="text-[44px] xl:text-[52px] leading-[1.04] font-semibold tracking-[-0.025em]">
            The roster knows the limit. It never knows the reason.
          </h1>
          <p className="mt-6 text-[15px] leading-relaxed text-white/70 max-w-[46ch]">
            Occupational health sets a work restriction. The scheduler receives a number
            and a date. Managers see that a restriction applies. Nobody outside
            occupational health sees why.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 max-w-lg border-t border-white/15 pt-6">
          {[['2', 'separate databases'], ['10', 'constraint types, no free text'], ['0', 'diagnoses in the HR store']].map(([v, l]) => (
            <div key={l}>
              <dt className="text-[30px] leading-none font-semibold num text-[#4FD1BC]">{v}</dt>
              <dd className="text-[12.5px] text-white/60 mt-1.5 leading-snug">{l}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col justify-center px-6 sm:px-10 py-10 bg-surface overflow-y-auto">
        <div className="w-full max-w-[380px] mx-auto">
          <h2 className="text-[22px] font-semibold tracking-tight">Sign in</h2>
          <p className="text-[13.5px] text-ink-70 mt-1.5">
            Use one of the demonstration accounts below. All data is synthetic.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" value={email} autoComplete="username"
                     onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <Banner tone="error" title="Sign-in failed">{error}</Banner>}
            <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          </form>

          <div className="mt-7 pt-5 border-t border-ink-10">
            <p className="text-[12px] font-semibold text-ink-70 mb-2">
              Demonstration accounts · password <span className="num">Demo@1234</span>
            </p>
            <ul className="divide-y divide-ink-10/70">
              {DEMO.map(([name, role, mail]) => (
                <li key={mail}>
                  <button type="button" onClick={() => { setEmail(mail); setPassword('Demo@1234'); }}
                    className="w-full text-left py-2 group">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-medium group-hover:text-signal">{name}</span>
                      <span className="text-[11.5px] text-ink-50 text-right">{role}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
