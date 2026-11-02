"""Request / response contracts for the scheduling service.

Note what the Employee model does NOT contain: no diagnosis, no clinical
note, no health status, no reason for any constraint. The solver receives a
constraint TYPE and numeric PARAMETERS and nothing else. It is structurally
incapable of discriminating on a medical basis because it never learns one.
"""
from typing import Optional, Literal
from pydantic import BaseModel, Field


class Employee(BaseModel):
    id: int
    name: str
    department_id: int
    qualifications: list[str] = []
    contracted_hours_per_week: float = 40.0
    # Voluntary, opt-in only. 0 means "do not offer extra hours".
    voluntary_extra_cap_hours: float = 0.0
    # Operational fatigue score (0-100). Computed from hours/nights/rest only.
    fatigue_score: float = 0.0
    fatigue_at_ceiling: bool = False


class ShiftSlot(BaseModel):
    requirement_id: int
    date: str                      # YYYY-MM-DD
    department_id: int
    template_id: int
    template_code: str
    duration_hours: float
    is_night: bool = False
    workload_weight: float = 1.0
    required_count: int = 1
    required_qualification: Optional[str] = None
    # How costly it is to leave this slot unfilled, relative to a baseline of
    # 1.0. A night in intensive care is not interchangeable with an
    # outpatient morning: without this, minimising the COUNT of unfilled
    # slots makes the solver abandon long, critical shifts first because they
    # consume more of a scarce hours budget per slot filled.
    coverage_weight: float = 1.0


class Constraint(BaseModel):
    """A firewall-projected restriction. Diagnosis-free by construction."""
    employee_id: int
    type: str
    params: dict = {}
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None


class LeaveDay(BaseModel):
    employee_id: int
    date: str


class Preference(BaseModel):
    employee_id: int
    template_id: int
    weight: int = 0                # -2 .. +2


class SolveRequest(BaseModel):
    period_start: str
    period_end: str
    employees: list[Employee]
    shifts: list[ShiftSlot]
    constraints: list[Constraint] = []
    leave: list[LeaveDay] = []
    preferences: list[Preference] = []
    max_time_seconds: float = 20.0
    # Weights for the soft objectives.
    w_coverage: int = 1000
    w_night_fairness: int = 12
    w_preference: int = 4
    w_voluntary_extra: int = 25
    w_load_balance: int = 8


class Assignment(BaseModel):
    requirement_id: int
    employee_id: int
    date: str
    hours: float
    workload_weight: float
    is_voluntary_extra: bool = False


class Shortfall(BaseModel):
    requirement_id: int
    date: str
    template_code: str
    department_id: int
    required: int
    filled: int
    missing: int
    reasons: list[str]
    alternatives: list[str]


class SolveResponse(BaseModel):
    status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "ERROR"]
    engine: str = "cp-sat"
    runtime_ms: int
    assignments: list[Assignment] = []
    shortfalls: list[Shortfall] = []
    metrics: dict = Field(default_factory=dict)
    message: Optional[str] = None
