export type Role =
  | 'EMPLOYEE' | 'LINE_MANAGER' | 'ROSTER_PLANNER' | 'HR_ADMIN'
  | 'OH_OFFICER' | 'COMPLIANCE_AUDITOR' | 'SYSTEM_ADMIN';

export interface Me {
  userId: number; email: string; role: Role; employeeId: number | null;
  roleLabel: string; name: string; empCode: string | null; designation: string | null;
}
export interface Restriction {
  opaqueRef: string; type: string; description: string;
  effectiveFrom: string; effectiveTo: string | null; note: string;
}
export interface Employee {
  id: number; empCode: string; firstName: string; lastName: string; email: string;
  designation: string; employmentType: string; contractedFte: number;
  contractedHoursPerWeek: number; status: string;
  departmentId: number; departmentName: string; facilityName: string;
  restrictions: Restriction[];
}
export interface Shift {
  id: number; date: string; hours: number; isVoluntaryExtra: boolean; status: string;
  templateCode: string; templateName: string; startTime: string; endTime: string;
  isNight: boolean; departmentName: string; rosterStatus: string; rosterName: string;
}
export interface Fatigue {
  employeeId: number; asOfDate: string; score: number;
  band: 'OK' | 'ELEVATED' | 'HIGH' | 'CRITICAL'; atCeiling: boolean;
  drivers: string[];
  components: {
    hoursLast7: number; hoursLast28: number; contractedWeeklyHours: number;
    loadRatio: number; consecutiveDays: number; nightsLast14: number;
    shortRestCount: number; weekendsLast28: number; voluntaryExtraLast28: number;
  };
  employee?: { id: number; firstName: string; lastName: string; empCode: string } | null;
}
export interface Capacity {
  employeeId: number; contractedHoursPerWeek: number; contractedFte: number;
  effectiveDailyCapHours: number; effectiveWeeklyCapHours: number;
  maxDailyWorkload: number | null; excludesNights: boolean; excludesWeekends: boolean;
  minRestHours: number | null; maxConsecutiveDays: number | null;
  eligibleForVoluntaryExtra: boolean; voluntaryExtraCapHours: number;
  blockedReason: string | null;
}
