// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE BOUNDARY, ENFORCED MECHANICALLY
 *
 *  Until now the rule "only health.service.ts may touch the health database"
 *  was held by code review and a test. Both are good; neither stops a
 *  developer at the moment they write the import.
 *
 *  These rules fail the build instead. A new engineer who writes
 *  `import { healthDb }` in a route handler finds out immediately, with an
 *  error that explains why rather than just forbidding it.
 * ═════════════════════════════════════════════════════════════════════════ */

const HEALTH_IMPORT_MESSAGE = [
  'The health database is reachable from exactly one module: services/health.service.ts.',
  '',
  'It holds diagnoses and clinical notes. Every other part of this system works',
  'from the firewall projection instead — a constraint type, numeric parameters',
  'and dates, with no reason attached.',
  '',
  'If you need a work restriction, use firewall.constraintsForScheduler() or',
  'firewall.constraintsForManager(). If you genuinely need clinical data, the',
  'call belongs inside health.service.ts behind its role check, not here.',
].join('\n');

const CONSTRAINT_STORE_MESSAGE = [
  'This module must not read the scheduling-constraint store.',
  '',
  'Performance, analytics, fairness and the assistant are deliberately blind to',
  'who holds a restriction. That blindness is the guarantee — a module that',
  'cannot see restrictions cannot act on them, rank by them, or publish a',
  'breakdown of them.',
].join('\n');

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  /* ── Rule 1: the health client has exactly one importer ───────────────── */
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/services/health.service.ts',   // the one permitted door
      'src/db/index.ts',                  // creates both clients
      'src/db/health.schema.ts',          // defines the schema
      'src/db/migrate.ts',                // creates the tables
      'src/db/seed.ts',                   // seeds synthetic data
      'src/__tests__/**',                 // tests assert the boundary holds
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '../db/index.js', importNames: ['healthDb', 'healthConnection'], message: HEALTH_IMPORT_MESSAGE },
          { name: '../../db/index.js', importNames: ['healthDb', 'healthConnection'], message: HEALTH_IMPORT_MESSAGE },
          { name: './index.js', importNames: ['healthDb', 'healthConnection'], message: HEALTH_IMPORT_MESSAGE },
          { name: '../db/health.schema.js', message: HEALTH_IMPORT_MESSAGE },
          { name: '../../db/health.schema.js', message: HEALTH_IMPORT_MESSAGE },
        ],
        patterns: [
          { group: ['**/health.schema.js', '**/health.schema'], message: HEALTH_IMPORT_MESSAGE },
        ],
      }],
    },
  },

  /* ── Rule 2: modules that must stay blind to restrictions ─────────────── */
  {
    files: [
      'src/services/performance.service.ts',
      'src/services/analytics.service.ts',
      'src/services/fairness.service.ts',
      'src/services/assistant.service.ts',
      'src/services/recruitment.service.ts',
      'src/services/workplace.service.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '../db/index.js', importNames: ['healthDb', 'healthConnection'], message: HEALTH_IMPORT_MESSAGE },
          { name: './firewall.service.js', message: CONSTRAINT_STORE_MESSAGE },
          { name: '../services/firewall.service.js', message: CONSTRAINT_STORE_MESSAGE },
          { name: './health.service.js', message: HEALTH_IMPORT_MESSAGE },
        ],
        patterns: [
          { group: ['**/health.schema.js', '**/health.schema'], message: HEALTH_IMPORT_MESSAGE },
          { group: ['**/firewall.service.js', '**/firewall.service'], message: CONSTRAINT_STORE_MESSAGE },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportSpecifier[imported.name="schedulingConstraints"]',
        message: CONSTRAINT_STORE_MESSAGE,
      }],
    },
  },
);
