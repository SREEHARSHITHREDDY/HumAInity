#!/usr/bin/env node
/* Creates a dedicated virtual environment for the scheduling service.
 *
 * Why this exists: a machine often has several Pythons. `pip` may install
 * into one while `python3` resolves to another, and the solver then starts
 * under an interpreter where OR-Tools is not present. A venv pinned to a
 * known-good interpreter removes the ambiguity entirely.
 *
 * OR-Tools publishes wheels for CPython 3.9–3.13. Newer versions are skipped
 * rather than attempted, because the failure there is a confusing build error
 * rather than a clear "unsupported".                                        */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = path.join(ROOT, 'services', 'scheduler');
const VENV = path.join(SERVICE, '.venv');
const isWin = process.platform === 'win32';
const venvPython = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

const MIN = [3, 9];
const MAX = [3, 13];           // highest version OR-Tools ships wheels for

const candidates = isWin
  ? ['py -3.13', 'py -3.12', 'py -3.11', 'py -3.10', 'python']
  : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python'];

const versionOf = (cmd) => {
  const [bin, ...args] = cmd.split(' ');
  const r = spawnSync(bin, [...args, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'],
    { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const [maj, min] = r.stdout.trim().split('.').map(Number);
  return Number.isFinite(maj) && Number.isFinite(min) ? [maj, min] : null;
};

const inRange = ([maj, min]) =>
  maj === 3 && min >= MIN[1] && min <= MAX[1];

console.log('\n  Looking for a Python that OR-Tools supports (3.9 to 3.13)…\n');

let chosen = null;
const seen = [];
for (const cmd of candidates) {
  const v = versionOf(cmd);
  if (!v) continue;
  const label = `${cmd} → ${v[0]}.${v[1]}`;
  if (inRange(v)) { console.log(`  ✓ ${label}`); chosen = cmd; break; }
  if (!seen.includes(label)) { seen.push(label); console.log(`  ✗ ${label}  (OR-Tools has no wheel for this version)`); }
}

if (!chosen) {
  console.error(
`
  No suitable Python found.

  OR-Tools publishes wheels for CPython 3.9 to 3.13. The interpreters on this
  machine are either outside that range or not on PATH.

  On macOS, the quickest route:
      brew install python@3.13
      npm run setup:solver

  The application runs without this. The API falls back to a built-in
  TypeScript scheduling engine that enforces every hard rule — rosters are
  simply labelled "heuristic-fallback" instead of "cp-sat".
`);
  process.exit(1);
}

if (!existsSync(SERVICE)) mkdirSync(SERVICE, { recursive: true });

if (!existsSync(venvPython)) {
  console.log(`\n  Creating ${path.relative(ROOT, VENV)} …`);
  const [bin, ...args] = chosen.split(' ');
  execFileSync(bin, [...args, '-m', 'venv', VENV], { stdio: 'inherit' });
} else {
  console.log(`\n  Reusing the existing virtual environment.`);
}

console.log('  Installing the solver dependencies …\n');
execFileSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'], { stdio: 'inherit' });
execFileSync(venvPython, ['-m', 'pip', 'install', '-r', path.join(SERVICE, 'requirements.txt')],
  { stdio: 'inherit' });

const check = spawnSync(venvPython,
  ['-c', 'from ortools.sat.python import cp_model; import uvicorn; print("ok")'],
  { encoding: 'utf8' });

if (check.status === 0) {
  console.log(`\n  CP-SAT is ready. Start everything with:  npm run dev\n`);
} else {
  console.error(`\n  The packages installed but could not be imported:\n${check.stderr}`);
  process.exit(1);
}
