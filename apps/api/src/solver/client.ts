import { env } from '../lib/env.js';
import { solveFallback } from './fallback.js';
import type { SolveRequest, SolveResponse } from './types.js';

export async function solve(req: SolveRequest): Promise<SolveResponse> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), env.SOLVER_TIMEOUT_MS);
    const res = await fetch(`${env.SOLVER_URL}/solve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Solver returned ${res.status}`);
    const data = (await res.json()) as SolveResponse;
    if (data.status === 'ERROR') throw new Error(data.message ?? 'Solver error');
    return { ...data, engine: data.engine || 'cp-sat' };
  } catch (err) {
    if (!env.SOLVER_FALLBACK_ENABLED) throw err;
    console.warn(`[solver] CP-SAT unavailable (${(err as Error).message}); using fallback engine`);
    return solveFallback(req);
  }
}

export async function solverHealth() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`${env.SOLVER_URL}/health`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { available: false, engine: 'heuristic-fallback' as const };
    return { available: true, engine: 'cp-sat' as const, ...(await res.json()) };
  } catch {
    return { available: false, engine: 'heuristic-fallback' as const };
  }
}
