/* Puts the application into a known state before the suite runs.
 *
 * Several assertions depend on work having happened — a roster generated and
 * approved, pay calculated, restrictions projected. Doing that through the
 * API here keeps each test about one behaviour, instead of every test first
 * clicking through setup it does not care about. */
const API = 'http://127.0.0.1:4000/api';
const PASSWORD = 'Demo@1234';

async function token(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

const call = (path: string, tok: string, body?: unknown) =>
  fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export default async function globalSetup() {
  const oh = await token('anita.bose@humainity.io');
  const planner = await token('harish.kumar@humainity.io');
  const hr = await token('deepak.sharma@humainity.io');

  // Project the seeded restrictions through the firewall.
  await call('/workforce/firewall/sync', oh, {});

  // A roster the tests can inspect, unless one already exists.
  const rosters = await (await call('/schedule/rosters', planner)).json();
  if (!Array.isArray(rosters) || rosters.length === 0) {
    const gen = await call('/schedule/rosters/generate', planner, {
      name: 'E2E fortnight roster',
      periodStart: '2026-10-26', periodEnd: '2026-11-08',
      maxTimeSeconds: 25,
    });
    const created = await gen.json();
    if (created?.rosterId) await call(`/schedule/rosters/${created.rosterId}/approve`, planner, {});
  }

  // Pay lines, so an employee's payslip is populated.
  await call('/workforce/pay/periods/1/calculate', hr, {});

  console.log('  e2e: demo state prepared');
}
