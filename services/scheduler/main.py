"""HumAInity scheduling service.

A deliberately thin HTTP wrapper. It receives diagnosis-free constraints and
returns a roster. It has no database access of any kind — it cannot read the
health store even in principle, because it has no connection to it.
"""
from fastapi import FastAPI
from models import SolveRequest, SolveResponse
import solver

app = FastAPI(title="HumAInity Scheduling Engine", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "engine": "cp-sat", "service": "humainity-scheduler"}


@app.post("/solve", response_model=SolveResponse)
def solve_endpoint(req: SolveRequest) -> SolveResponse:
    try:
        return solver.solve(req)
    except Exception as exc:  # pragma: no cover
        return SolveResponse(status="ERROR", runtime_ms=0, message=str(exc))
