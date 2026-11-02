/* Occupational health console + the employee's own view.
 *
 * Every clinical endpoint here is role-gated INSIDE health.service.ts as
 * well as by the router, so a routing mistake alone cannot expose data.      */
import { Router } from 'express';
import { authenticate, requireRole, actor } from '../middleware/auth.js';
import { badRequest } from '../lib/errors.js';
import { CONSTRAINT_SCHEMAS, CONSTRAINT_LABEL, CONSTRAINT_TYPES } from '../lib/constraint-vocabulary.js';
import * as health from '../services/health.service.js';
import * as firewall from '../services/firewall.service.js';

export const healthRoutes = Router();
healthRoutes.use(authenticate);

/* ─── The closed vocabulary, for the OH console's form ───────────────────── */
healthRoutes.get('/constraint-types', (_req, res) => {
  res.json(CONSTRAINT_TYPES.map((t) => ({
    type: t, label: CONSTRAINT_LABEL[t],
    paramsSchema: Object.keys((CONSTRAINT_SCHEMAS[t] as any).shape ?? {}),
  })));
});

/* ─── Clinical zone — OH_OFFICER only ────────────────────────────────────── */

healthRoutes.get('/assessments', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const ref = req.query.employeeRef ? Number(req.query.employeeRef) : undefined;
    res.json(health.listAssessments(actor(req), ref));
  } catch (e) { next(e); }
});

healthRoutes.post('/assessments', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const { employeeRef, assessmentDate, fitnessStatus, clinicalNotes, diagnosisCode, reviewDate } = req.body ?? {};
    if (!employeeRef || !assessmentDate || !fitnessStatus) {
      throw badRequest('employeeRef, assessmentDate and fitnessStatus are required');
    }
    res.status(201).json(health.createAssessment(actor(req), {
      employeeRef: Number(employeeRef), assessmentDate, fitnessStatus,
      clinicalNotes, diagnosisCode, reviewDate,
    }));
  } catch (e) { next(e); }
});

healthRoutes.get('/restrictions', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const ref = req.query.employeeRef ? Number(req.query.employeeRef) : undefined;
    res.json(health.listRestrictionsForOfficer(actor(req), ref));
  } catch (e) { next(e); }
});

healthRoutes.post('/restrictions', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const { employeeRef, assessmentId, restrictionType, params, effectiveFrom, effectiveTo } = req.body ?? {};
    if (!employeeRef || !assessmentId || !restrictionType || !effectiveFrom) {
      throw badRequest('employeeRef, assessmentId, restrictionType and effectiveFrom are required');
    }
    const created = health.createRestriction(actor(req), {
      employeeRef: Number(employeeRef), assessmentId: Number(assessmentId),
      restrictionType, params: params ?? {}, effectiveFrom, effectiveTo: effectiveTo ?? null,
    });
    // Immediately push it through the firewall so the scheduler can use it.
    const sync = firewall.syncAll(actor(req));
    res.status(201).json({
      restriction: { id: created.id, opaqueRef: created.opaqueRef, restrictionType: created.restrictionType },
      firewall: sync,
      message: 'Restriction authorised and projected. The scheduler now has the limit; it does not have the reason.',
    });
  } catch (e) { next(e); }
});

healthRoutes.post('/restrictions/:id/revoke', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    health.revokeRestriction(actor(req), Number(req.params.id));
    res.json({ ok: true, firewall: firewall.syncAll(actor(req)) });
  } catch (e) { next(e); }
});

healthRoutes.get('/access-trail', requireRole('OH_OFFICER', 'COMPLIANCE_AUDITOR'), (req, res, next) => {
  try {
    const ref = req.query.employeeRef ? Number(req.query.employeeRef) : undefined;
    res.json(health.healthAccessTrail(actor(req), ref));
  } catch (e) { next(e); }
});

healthRoutes.get('/check-ins', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const ref = req.query.employeeRef ? Number(req.query.employeeRef) : undefined;
    res.json(health.listCheckIns(actor(req), ref));
  } catch (e) { next(e); }
});

/* ─── Wellbeing check-in — an employee submits their OWN ─────────────────── */

healthRoutes.post('/check-ins', (req, res, next) => {
  try {
    const a = actor(req);
    const ref = Number(req.body?.employeeRef ?? a.employeeId);
    if (!ref) throw badRequest('No employee linked to this account');
    res.status(201).json({
      ...health.submitCheckIn(a, ref, req.body?.responses ?? {}),
      message: 'Thank you. Your responses are stored in the occupational health zone. ' +
               'Your manager cannot see them.',
    });
  } catch (e) { next(e); }
});

/* ─── An employee's own restrictions — label only, same as a manager sees ── */

healthRoutes.get('/my-restrictions', (req, res, next) => {
  try {
    const id = req.user!.employeeId;
    if (!id) return res.json([]);
    res.json(firewall.constraintsForSelfDetailed(id));
  } catch (e) { next(e); }
});

/* ═══════════════════════════════════════════════════════════════════════════
 *  SELF-DECLARED CAPACITY
 *  Lets an employee protect themselves on day one, without a hospital
 *  occupational health team and without disclosing anything medical.
 * ═════════════════════════════════════════════════════════════════════════ */

/** The functional capacity questionnaire. Asks what you can do at work. */
healthRoutes.get('/capacity/questions', (_req, res) =>
  res.json({
    questions: health.capacityQuestions(),
    note: 'Every question is about your work. None asks about a condition, a symptom or ' +
          'a diagnosis, and you are never required to give one.',
  }));

/** Turns answers into suggestions. Applies nothing. */
healthRoutes.post('/capacity/suggest', (req, res, next) => {
  try { res.json(health.suggestCapacity(req.body?.answers ?? {})); }
  catch (e) { next(e); }
});

/** The employee declares a limit on their own work. */
healthRoutes.post('/capacity/declare', (req, res, next) => {
  try {
    const { restrictionType, params, effectiveFrom, employeeNote } = req.body ?? {};
    if (!restrictionType) throw badRequest('restrictionType is required');
    const row = health.selfDeclareRestriction(actor(req), {
      restrictionType, params: params ?? {}, effectiveFrom, employeeNote,
    });
    const sync = firewall.syncAll(actor(req));
    res.status(201).json({
      declared: { opaqueRef: row.opaqueRef, restrictionType: row.restrictionType, effectiveTo: row.effectiveTo },
      firewall: sync,
      message: `Applied. The scheduler will respect this from your next roster. It is provisional ` +
               `for ${health.SELF_DECLARED_DAYS} days — occupational health can confirm it, or you can renew it.`,
    });
  } catch (e) { next(e); }
});

/** Everything this employee has declared, with provenance. */
healthRoutes.get('/capacity/mine', (req, res, next) => {
  try { res.json(health.myDeclarations(actor(req))); }
  catch (e) { next(e); }
});

healthRoutes.post('/capacity/:id/withdraw', (req, res, next) => {
  try {
    const r = health.withdrawDeclaration(actor(req), Number(req.params.id));
    firewall.syncAll(actor(req));
    res.json({ ...r, message: 'Withdrawn. Your next roster will no longer apply it.' });
  } catch (e) { next(e); }
});

/** OH confirms a self-declared limit, making it durable. */
healthRoutes.post('/capacity/:id/verify', requireRole('OH_OFFICER'), (req, res, next) => {
  try {
    const r = health.verifyDeclaration(actor(req), Number(req.params.id), req.body?.effectiveTo);
    firewall.syncAll(actor(req));
    res.json({ ...r, message: 'Confirmed and extended.' });
  } catch (e) { next(e); }
});

healthRoutes.get('/capacity/pending', requireRole('OH_OFFICER'), (req, res, next) => {
  try { res.json(health.pendingVerification(actor(req))); }
  catch (e) { next(e); }
});

/** Encryption posture, for the compliance view. */
healthRoutes.get('/encryption-status', requireRole('OH_OFFICER', 'COMPLIANCE_AUDITOR', 'SYSTEM_ADMIN'), (_req, res) =>
  res.json(health.encryptionStatus()));

