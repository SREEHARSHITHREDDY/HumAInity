/* Two databases, two connections, two clients.
 *
 * `hrDb` is imported freely across the application.
 * `healthDb` is imported by exactly ONE module: services/health.service.ts.
 * A lint rule (docs/ARCHITECTURE.md §4) and the test in
 * src/__tests__/firewall.test.ts both enforce that boundary.                */
import '../lib/load-env.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hrSchema from './hr.schema.js';
import * as healthSchema from './health.schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../../../..');

const resolve = (v: string | undefined, fallback: string) => {
  const raw = (v ?? fallback).replace(/^file:/, '');
  return path.isAbsolute(raw) ? raw : path.join(ROOT, path.basename(raw));
};

export const HR_DB_PATH = resolve(process.env.HR_DATABASE_URL, 'hr.db');
export const HEALTH_DB_PATH = resolve(process.env.HEALTH_DATABASE_URL, 'health.db');

const hrConn = new Database(HR_DB_PATH);
const healthConn = new Database(HEALTH_DB_PATH);
hrConn.pragma('journal_mode = WAL');
hrConn.pragma('foreign_keys = ON');
healthConn.pragma('journal_mode = WAL');
healthConn.pragma('foreign_keys = ON');

export const hrDb = drizzle(hrConn, { schema: hrSchema });
export const healthDb = drizzle(healthConn, { schema: healthSchema });
export const hrConnection = hrConn;
export const healthConnection = healthConn;
export { hrSchema, healthSchema };
