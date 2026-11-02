/* ═══════════════════════════════════════════════════════════════════════════
 *  Loads .env from the REPOSITORY ROOT, whatever the working directory is.
 *
 *  `import 'dotenv/config'` reads .env relative to process.cwd(). npm
 *  workspace scripts run from apps/api, so the root .env was silently ignored
 *  — the application started happily on defaults and nobody noticed.
 *
 *  For most settings that is merely untidy. For HEALTH_ENCRYPTION_KEY it is
 *  dangerous: the operator sets a key, sees no error, and believes clinical
 *  data is encrypted when it is being written in plain text. Config that
 *  fails silently is worse than config that fails loudly.
 *
 *  This module must be imported before anything reads process.env.
 * ═════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk upwards for the directory holding the workspace root package.json. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (parsed.workspaces) return dir;
      } catch { /* keep walking */ }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(here, '../../../..');
}

export const REPO_ROOT = findRepoRoot(here);

/* Local overrides first, then the shared file. dotenv does not overwrite a
 * variable that is already set, so the earlier file wins — and a variable
 * exported in the real environment beats both, which is what a container or
 * a CI runner expects. */
for (const file of ['.env.local', '.env']) {
  const full = path.join(REPO_ROOT, file);
  if (fs.existsSync(full)) dotenv.config({ path: full });
}
