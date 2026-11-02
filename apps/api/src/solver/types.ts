export interface SolverEmployee {
  id: number; name: string; department_id: number; qualifications: string[];
  contracted_hours_per_week: number; voluntary_extra_cap_hours: number;
  fatigue_score: number; fatigue_at_ceiling: boolean;
}
export interface SolverShift {
  requirement_id: number; date: string; department_id: number; template_id: number;
  template_code: string; duration_hours: number; is_night: boolean;
  workload_weight: number; required_count: number; required_qualification: string | null;
  coverage_weight: number;
}
export interface SolverConstraint {
  employee_id: number; type: string; params: Record<string, unknown>;
  effective_from?: string | null; effective_to?: string | null;
}
export interface SolveRequest {
  period_start: string; period_end: string;
  employees: SolverEmployee[]; shifts: SolverShift[];
  constraints: SolverConstraint[];
  leave: Array<{ employee_id: number; date: string }>;
  preferences: Array<{ employee_id: number; template_id: number; weight: number }>;
  max_time_seconds: number;
}
export interface SolverAssignment {
  requirement_id: number; employee_id: number; date: string;
  hours: number; workload_weight: number; is_voluntary_extra: boolean;
}
export interface Shortfall {
  requirement_id: number; date: string; template_code: string; department_id: number;
  required: number; filled: number; missing: number;
  reasons: string[]; alternatives: string[];
}
export interface SolveResponse {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'ERROR';
  engine: string; runtime_ms: number;
  assignments: SolverAssignment[]; shortfalls: Shortfall[];
  metrics: Record<string, any>; message?: string | null;
}
