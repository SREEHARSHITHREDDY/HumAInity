/* Tier 2 — the standard HR portal.
 * Performance, recruitment, onboarding, documents, offboarding, helpdesk,
 * the assistant and analytics. */
import { Router } from 'express';
import { authenticate, requireRole, requireRoleOrSelf, actor } from '../middleware/auth.js';
import { badRequest } from '../lib/errors.js';
import { DIRECTORY_ROLES } from '../lib/roles.js';
import { dayKey, addDays } from '../lib/dates.js';
import * as perf from '../services/performance.service.js';
import * as rec from '../services/recruitment.service.js';
import * as work from '../services/workplace.service.js';
import * as assistant from '../services/assistant.service.js';
import * as analytics from '../services/analytics.service.js';

export const portalRoutes = Router();
portalRoutes.use(authenticate);

const MANAGE = ['LINE_MANAGER', 'HR_ADMIN', 'SYSTEM_ADMIN'] as const;
const HR_ONLY = ['HR_ADMIN', 'SYSTEM_ADMIN'] as const;
const RECRUIT = ['HR_ADMIN', 'SYSTEM_ADMIN', 'LINE_MANAGER'] as const;

/* ═══════════════════════════ PERFORMANCE ═══════════════════════════════ */

portalRoutes.get('/performance/competencies', (_req, res) => res.json(perf.competencyCatalogue()));
portalRoutes.get('/performance/cycles', (_req, res) => res.json(perf.listCycles()));

portalRoutes.post('/performance/cycles', requireRole(...HR_ONLY), (req, res, next) => {
  try {
    const { name, periodStart, periodEnd } = req.body ?? {};
    if (!name || !periodStart || !periodEnd) throw badRequest('name, periodStart and periodEnd are required');
    res.status(201).json(perf.createCycle(actor(req), { name, periodStart, periodEnd }));
  } catch (e) { next(e); }
});

portalRoutes.get('/performance/goals/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) =>
  res.json(perf.listGoals(Number(req.params.employeeId))));

portalRoutes.post('/performance/goals', requireRole(...MANAGE), (req, res, next) => {
  try { res.status(201).json(perf.createGoal(actor(req), req.body ?? {})); }
  catch (e) { next(e); }
});

portalRoutes.patch('/performance/goals/:id', requireRole(...MANAGE), (req, res, next) => {
  try { res.json(perf.updateGoal(actor(req), Number(req.params.id), req.body ?? {})); }
  catch (e) { next(e); }
});

/** Goal attainment, scored per hour worked so fewer hours cannot lower it. */
portalRoutes.get('/performance/score/:employeeId/:cycleId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res, next) => {
  try { res.json(perf.scoreGoals(Number(req.params.employeeId), Number(req.params.cycleId))); }
  catch (e) { next(e); }
});

portalRoutes.get('/performance/reviews', requireRole(...DIRECTORY_ROLES), (req, res) =>
  res.json(perf.listReviews(req.query.cycleId ? Number(req.query.cycleId) : undefined)));

portalRoutes.get('/performance/reviews/:employeeId/:cycleId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) =>
  res.json(perf.reviewFor(Number(req.params.employeeId), Number(req.params.cycleId))));

portalRoutes.post('/performance/reviews', requireRole(...MANAGE), (req, res, next) => {
  try {
    const { cycleId, employeeId, ratings, strengths, development, submit } = req.body ?? {};
    if (!cycleId || !employeeId) throw badRequest('cycleId and employeeId are required');
    res.json(perf.saveReview(actor(req), {
      cycleId: Number(cycleId), employeeId: Number(employeeId),
      ratings: ratings ?? {}, strengths, development, submit: !!submit,
    }));
  } catch (e) { next(e); }
});

portalRoutes.post('/performance/reviews/:id/acknowledge', (req, res, next) => {
  try { res.json(perf.acknowledgeReview(actor(req), Number(req.params.id), req.body?.comment)); }
  catch (e) { next(e); }
});

/** Compliance view: reviews whose narrative mentions working pattern. */
portalRoutes.get('/performance/flagged', requireRole('COMPLIANCE_AUDITOR', 'HR_ADMIN', 'SYSTEM_ADMIN'), (_req, res) =>
  res.json(perf.flaggedReviews()));

/* ═══════════════════════════ RECRUITMENT ═══════════════════════════════ */

portalRoutes.get('/recruitment/postings', (_req, res) => res.json(rec.listPostings()));

portalRoutes.post('/recruitment/postings', requireRole(...RECRUIT), (req, res, next) => {
  try { res.status(201).json(rec.createPosting(actor(req), req.body ?? {})); }
  catch (e) { next(e); }
});

portalRoutes.get('/recruitment/pipeline', requireRole(...RECRUIT), (req, res) =>
  res.json(rec.pipeline(req.query.jobPostingId ? Number(req.query.jobPostingId) : undefined)));

portalRoutes.post('/recruitment/apply', requireRole(...RECRUIT), (req, res, next) => {
  try { res.status(201).json(rec.apply(req.body ?? {})); }
  catch (e) { next(e); }
});

/** Produces an advisory summary. It cannot reject anyone. */
portalRoutes.post('/recruitment/applications/:id/screen', requireRole(...RECRUIT), (req, res, next) => {
  try { res.json(rec.screen(actor(req), Number(req.params.id))); }
  catch (e) { next(e); }
});

portalRoutes.post('/recruitment/postings/:id/screen-all', requireRole(...RECRUIT), (req, res, next) => {
  try {
    const out = rec.screenAll(actor(req), Number(req.params.id));
    res.json({
      screened: out.length, results: out,
      note: 'Advisory only. No application was advanced or rejected automatically.',
    });
  } catch (e) { next(e); }
});

/** The only route that can change a candidate's outcome. */
portalRoutes.post('/recruitment/applications/:id/decide', requireRole(...RECRUIT), (req, res, next) => {
  try {
    const { stage, note } = req.body ?? {};
    if (!stage) throw badRequest('stage is required');
    res.json(rec.decide(actor(req), Number(req.params.id), stage, note));
  } catch (e) { next(e); }
});

portalRoutes.get('/recruitment/interviews', requireRole(...RECRUIT), (_req, res) =>
  res.json(rec.listInterviews()));

portalRoutes.post('/recruitment/interviews', requireRole(...RECRUIT), (req, res, next) => {
  try { res.status(201).json(rec.scheduleInterview(actor(req), req.body ?? {})); }
  catch (e) { next(e); }
});

/** Checks a proposed slot against the roster before anyone commits to it. */
portalRoutes.get('/recruitment/interviews/conflict', requireRole(...RECRUIT), (req, res) => {
  const at = String(req.query.scheduledAt ?? '');
  const who = Number(req.query.interviewerId ?? req.user!.userId);
  const conflict = rec.interviewerConflict(who, at);
  res.json({ clear: !conflict, conflict });
});

portalRoutes.post('/recruitment/interviews/:id/outcome', requireRole(...RECRUIT), (req, res, next) => {
  try {
    const { outcome, notes } = req.body ?? {};
    res.json(rec.recordInterviewOutcome(actor(req), Number(req.params.id), outcome, notes));
  } catch (e) { next(e); }
});

/* ═══════════════════════════ ONBOARDING ════════════════════════════════ */

portalRoutes.get('/onboarding', requireRole(...DIRECTORY_ROLES), (_req, res) =>
  res.json(work.allOnboarding()));

portalRoutes.get('/onboarding/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) =>
  res.json(work.listOnboarding(Number(req.params.employeeId))));

portalRoutes.get('/onboarding/me/tasks', (req, res) =>
  res.json(req.user!.employeeId ? work.listOnboarding(req.user!.employeeId) : []));

portalRoutes.post('/onboarding/start', requireRole(...HR_ONLY), (req, res, next) => {
  try {
    const { employeeId, startDate } = req.body ?? {};
    if (!employeeId) throw badRequest('employeeId is required');
    res.status(201).json(work.startOnboarding(actor(req), Number(employeeId), startDate));
  } catch (e) { next(e); }
});

portalRoutes.patch('/onboarding/tasks/:id', (req, res, next) => {
  try {
    const { status, notes } = req.body ?? {};
    res.json(work.updateOnboardingTask(actor(req), Number(req.params.id), status, notes));
  } catch (e) { next(e); }
});

/* ═══════════════════════════ DOCUMENTS ═════════════════════════════════ */

portalRoutes.get('/documents', (req, res) => res.json(work.listDocuments(actor(req))));

portalRoutes.post('/documents', requireRole(...HR_ONLY), (req, res, next) => {
  try { res.status(201).json(work.createDocument(actor(req), req.body ?? {})); }
  catch (e) { next(e); }
});

portalRoutes.post('/documents/:id/acknowledge', (req, res, next) => {
  try { res.json(work.acknowledgeDocument(actor(req), Number(req.params.id))); }
  catch (e) { next(e); }
});

portalRoutes.get('/documents/:id/acknowledgements', requireRole(...MANAGE, 'COMPLIANCE_AUDITOR'), (req, res, next) => {
  try { res.json(work.acknowledgementReport(Number(req.params.id))); }
  catch (e) { next(e); }
});

/* ═══════════════════════════ OFFBOARDING ═══════════════════════════════ */

portalRoutes.get('/offboarding', requireRole(...MANAGE, 'COMPLIANCE_AUDITOR'), (_req, res) =>
  res.json(work.listOffboarding()));

portalRoutes.post('/offboarding', requireRole(...HR_ONLY), (req, res, next) => {
  try {
    const { employeeId, lastWorkingDay, reason } = req.body ?? {};
    if (!employeeId || !lastWorkingDay || !reason) {
      throw badRequest('employeeId, lastWorkingDay and reason are required');
    }
    res.status(201).json(work.startOffboarding(actor(req), {
      employeeId: Number(employeeId), lastWorkingDay, reason,
    }));
  } catch (e) { next(e); }
});

portalRoutes.patch('/offboarding/:id', requireRole(...HR_ONLY), (req, res, next) => {
  try {
    const { key, done } = req.body ?? {};
    if (!key) throw badRequest('key is required');
    res.json(work.updateOffboarding(actor(req), Number(req.params.id), key, !!done));
  } catch (e) { next(e); }
});

/* ═══════════════════════════ HELPDESK ══════════════════════════════════ */

portalRoutes.get('/tickets', (req, res) => res.json(work.listTickets(actor(req))));

portalRoutes.post('/tickets', (req, res, next) => {
  try { res.status(201).json(work.createTicket(actor(req), req.body ?? {})); }
  catch (e) { next(e); }
});

portalRoutes.patch('/tickets/:id', (req, res, next) => {
  try { res.json(work.updateTicket(actor(req), Number(req.params.id), req.body ?? {})); }
  catch (e) { next(e); }
});

/* ═══════════════════════════ ASSISTANT ═════════════════════════════════ */

portalRoutes.post('/assistant/ask', (req, res, next) => {
  try {
    const q = String(req.body?.question ?? '');
    if (q.length > 500) throw badRequest('Keep the question under 500 characters.');
    res.json(assistant.ask(actor(req), q));
  } catch (e) { next(e); }
});

portalRoutes.get('/assistant/history', (req, res) => res.json(assistant.history(actor(req))));

/** Evidence for an auditor that the assistant never reached for health data. */
portalRoutes.get('/assistant/source-audit', requireRole('COMPLIANCE_AUDITOR', 'HR_ADMIN', 'SYSTEM_ADMIN', 'OH_OFFICER'), (_req, res) =>
  res.json(assistant.sourceAudit()));

/* ═══════════════════════════ ANALYTICS ═════════════════════════════════ */

portalRoutes.get('/analytics', requireRole(...DIRECTORY_ROLES), (req, res) => {
  const from = String(req.query.from ?? dayKey(addDays(dayKey(new Date()), -27)));
  const to = String(req.query.to ?? dayKey(addDays(dayKey(new Date()), 13)));
  res.json(analytics.overview(from, to));
});
