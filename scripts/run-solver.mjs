#!/usr/bin/env node
/* Starts the scheduling service using the dedicated virtual environment when
 * one exists, and otherwise falls back to whatever `python3` is on PATH.
 *
 * If OR-Tools is missing it says so plainly and exits without a stack trace:
 * the application works regardless, and a wall of traceback during a demo is
 * worse than a sentence explaining what happened.                           */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = path.join(ROOT, 'services', 'scheduler');
const isWin = process.platform === 'win32';
const venvPython = path.join(SERVICE, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

const python = existsSync(venvPython) ? venvPython : (isWin ? 'python' : 'python3');
const usingVenv = python === venvPython;

const probe = spawnSync(python, ['-c', 'from ortools.sat.python import cp_model'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error(
`
  The CP-SAT scheduling engine is not available${usingVenv ? ' in the virtual environment' : ` under ${python}`}.

  Set it up once with:   npm run setup:solver

  Until then the API uses its built-in TypeScript engine. It enforces every
  hard rule — qualifications, leave, rest, hour limits and health restrictions
  — and simply optimises less well. Rosters generated that way are labelled
  "heuristic-fallback" wherever they appear, so nothing is misreported.
`);
  process.exit(0);          // exit 0: this is a degraded mode, not a crash
}

console.log(`  Scheduling engine: ${usingVenv ? 'venv' : python} (CP-SAT ready)`);
spawn(python, ['-m', 'uvicorn', 'main:app', '--port', '8000', '--reload'],
  { cwd: SERVICE, stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0));
