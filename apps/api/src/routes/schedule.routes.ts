import { Router } from 'express';
import { and, eq, gte, lte } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { shiftTemplates, shiftRequirements, shiftPreferences, departments } from '../db/hr.schema.js';
import { authenticate, requireRole, requireRoleOrSelf, actor } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { DIRECTORY_ROLES } from '../lib/roles.js';
import * as scheduling from '../services/scheduling.service.js';
import * as solverClient from '../solver/client.js';
import { dayKey, addDays } from '../lib/dates.js';

export const scheduleRoutes = Router();
scheduleRoutes.use(authenticate);

scheduleRoutes.get('/templates', (_req, res) => res.json(hrDb.select().from(shiftTemplates).all()));

scheduleRoutes.get('/requirements', requireRole(...DIRECTORY_ROLES), (req, res) => {
  const from = String(req.query.from ?? dayKey(new Date()));
  const to = String(req.query.to ?? dayKey(addDays(new Date(), 13)));
  res.json(hrDb.select({
    id: shiftRequirements.id, date: shiftRequirements.date,
    requiredCount: shiftRequirements.requiredCount,
    requiredQualification: shiftRequirements.requiredQualification,
    departmentId: departments.id, departmentName: departments.name,
    templateCode: shiftTemplates.code, templateName: shiftTemplates.name,
    durationHours: shiftTemplates.durationHours, isNight: shiftTemplates.isNight,
  }).from(shiftRequirements)
    .innerJoin(departments, eq(departments.id, shiftRequirements.departmentId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(gte(shiftRequirements.date, from), lte(shiftRequirements.date, to)))
    .all());
});

scheduleRoutes.get('/solver/status', async (_req, res) => res.json(await solverClient.solverHealth()));

/* ─── Rosters ────────────────────────────────────────────────────────────── */

scheduleRoutes.get('/rosters', requireRole(...DIRECTORY_ROLES), (_req, res) =>
  res.json(scheduling.listRosters().map((r) => ({ ...r, metrics: r.metrics ? JSON.parse(r.metrics) : {} }))));

scheduleRoutes.get('/rosters/:id', requireRole(...DIRECTORY_ROLES), (req, res, next) => {
  try {
    const d = scheduling.rosterDetail(Number(req.params.id));
    if (!d) throw notFound('Roster not found');
    res.json(d);
  } catch (e) { next(e); }
});

scheduleRoutes.post('/rosters/generate', requireRole('ROSTER_PLANNER', 'HR_ADMIN', 'SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const { name, periodStart, periodEnd, departmentIds, maxTimeSeconds } = req.body ?? {};
    if (!periodStart || !periodEnd) throw badRequest('periodStart and periodEnd are required');
    const out = await scheduling.generateRoster(actor(req), {
      name: name || `Roster ${periodStart} to ${periodEnd}`,
      periodStart, periodEnd,
      departmentIds: Array.isArray(departmentIds) ? departmentIds.map(Number) : undefined,
      maxTimeSeconds: maxTimeSeconds ? Number(maxTimeSeconds) : undefined,
    });
    res.status(201).json({
      rosterId: out.roster.id,
      status: out.roster.status,
      solverStatus: out.result.status,
      engine: out.result.engine,
      runtimeMs: out.result.runtime_ms,
      metrics: out.result.metrics,
      shortfalls: out.result.shortfalls,
      violations: out.violations,
      firewall: out.firewall,
      validatorPassed: out.violations.length === 0,
      message: out.violations.length
        ? 'The independent validator found hard-rule violations. This roster is marked FAILED and cannot be approved.'
        : 'Roster generated. Health restrictions were applied without any diagnosis reaching the scheduler.',
    });
  } catch (e) { next(e); }
});

scheduleRoutes.post('/rosters/:id/approve', requireRole('ROSTER_PLANNER', 'HR_ADMIN', 'LINE_MANAGER', 'SYSTEM_ADMIN'), (req, res, next) => {
  try { res.json(scheduling.approveRoster(actor(req), Number(req.params.id))); }
  catch (e) { next(e); }
});

/* ─── Personal schedule ──────────────────────────────────────────────────── */

scheduleRoutes.get('/my', (req, res) => {
  const id = req.user!.employeeId;
  if (!id) return res.json([]);
  const from = String(req.query.from ?? dayKey(addDays(new Date(), -7)));
  const to = String(req.query.to ?? dayKey(addDays(new Date(), 28)));
  res.json(scheduling.scheduleForEmployee(id, from, to));
});

scheduleRoutes.get('/employee/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) => {
  const from = String(req.query.from ?? dayKey(addDays(new Date(), -7)));
  const to = String(req.query.to ?? dayKey(addDays(new Date(), 28)));
  res.json(scheduling.scheduleForEmployee(Number(req.params.employeeId), from, to));
});

/* ─── Preferences ────────────────────────────────────────────────────────── */

scheduleRoutes.get('/preferences', (req, res) => {
  const id = req.user!.employeeId;
  if (!id) return res.json([]);
  res.json(hrDb.select().from(shiftPreferences).where(eq(shiftPreferences.employeeId, id)).all());
});

scheduleRoutes.put('/preferences', (req, res, next) => {
  try {
    const id = req.user!.employeeId;
    if (!id) throw badRequest('No employee linked to this account');
    const items = req.body?.preferences;
    if (!Array.isArray(items)) throw badRequest('preferences must be an array');
    for (const p of items) {
      hrDb.insert(shiftPreferences).values({
        employeeId: id, shiftTemplateId: Number(p.shiftTemplateId), weight: Number(p.weight) || 0,
      }).onConflictDoUpdate({
        target: [shiftPreferences.employeeId, shiftPreferences.shiftTemplateId],
        set: { weight: Number(p.weight) || 0 },
      }).run();
    }
    res.json(hrDb.select().from(shiftPreferences).where(eq(shiftPreferences.employeeId, id)).all());
  } catch (e) { next(e); }
});
