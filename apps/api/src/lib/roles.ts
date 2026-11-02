export const ROLES = [
  'EMPLOYEE',
  'LINE_MANAGER',
  'ROSTER_PLANNER',
  'HR_ADMIN',
  'OH_OFFICER',
  'COMPLIANCE_AUDITOR',
  'SYSTEM_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  LINE_MANAGER: 'Line Manager',
  ROSTER_PLANNER: 'Roster Planner',
  HR_ADMIN: 'HR Admin',
  OH_OFFICER: 'Occupational Health Officer',
  COMPLIANCE_AUDITOR: 'Compliance Auditor',
  SYSTEM_ADMIN: 'System Admin',
};

/** The ONLY role that may reach the health database. Enforced in
 *  services/health.service.ts on every exported function. */
export const HEALTH_PRIVILEGED: Role[] = ['OH_OFFICER'];

/** Roles that may see the full employee directory. */
export const DIRECTORY_ROLES: Role[] = [
  'LINE_MANAGER', 'ROSTER_PLANNER', 'HR_ADMIN', 'OH_OFFICER', 'SYSTEM_ADMIN', 'COMPLIANCE_AUDITOR',
];
