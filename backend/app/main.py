from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import (
    TOKEN_TTL_SECONDS,
    AuthService,
    configure_auth_service,
    require_authenticated_payload,
)
from app.models import (
    Agent,
    ApiErrorDetail,
    ApiErrorResponse,
    LoginRequest,
    LoginResponse,
    Policy,
    PolicyEvent,
    PolicyEventsPage,
    PolicyEventCreate,
    ProductPlan,
    PoliciesPage,
    PaginationMeta,
    ProjectionRequest,
    ProjectionSnapshot,
)
from app.projection_engine import ProjectionEngine
from app.repository import JsonRepository

app = FastAPI(title="PAS Prototype API", version="0.5.0")

DB_DIR = Path(__file__).resolve().parent.parent / "localdb"
repo = JsonRepository(db_dir=DB_DIR)
auth_service = AuthService(repository=repo)
projection_engine = ProjectionEngine()
configure_auth_service(auth_service)

raw_origins = os.getenv(
    "PAS_CORS_ALLOWLIST",
    "http://localhost:5173,http://127.0.0.1:5173",
)
allow_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

rate_limit_window_seconds = 60
rate_limit_max_requests = 20
rate_limit_store: dict[str, deque[float]] = defaultdict(deque)


@app.middleware("http")
async def secure_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


def error_response(status_code: int, code: str, message: str, details: list[ApiErrorDetail] | None = None):
    payload = ApiErrorResponse(
        error={
            "code": code,
            "message": message,
            "details": details or [],
        }
    ).model_dump()
    return JSONResponse(status_code=status_code, content=payload)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    code = "unauthorized" if exc.status_code == status.HTTP_401_UNAUTHORIZED else "http_error"
    message = str(exc.detail)
    return error_response(exc.status_code, code, message)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    details = [
        ApiErrorDetail(
            field=".".join([str(part) for part in issue.get("loc", [])]),
            message=issue.get("msg", "Validation error"),
        )
        for issue in exc.errors()
    ]
    return error_response(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "validation_error",
        "Request validation failed",
        details,
    )


def enforce_write_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"{ip}:{request.url.path}"
    now = time.time()
    entries = rate_limit_store[key]

    while entries and now - entries[0] > rate_limit_window_seconds:
        entries.popleft()

    if len(entries) >= rate_limit_max_requests:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")

    entries.append(now)


def require_policy(policy_id: str) -> Policy:
    for policy in repo.read_list("policies.json", Policy):
        if policy.id == policy_id:
            return policy
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")


def require_plan(plan_id: str) -> ProductPlan:
    for plan in repo.read_list("product_plans.json", ProductPlan):
        if plan.id == plan_id:
            return plan
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product plan not found")


def ordered_policy_events(policy_id: str) -> list[PolicyEvent]:
    events = [event for event in repo.read_list("policy_events.json", PolicyEvent) if event.policyId == policy_id]
    return sorted(events, key=lambda item: (item.effectiveDate, item.id))


def paginate_items(items: list, page: int, page_size: int) -> tuple[list, PaginationMeta]:
    total = len(items)
    total_pages = max((total + page_size - 1) // page_size, 1)
    safe_page = min(max(page, 1), total_pages)
    start = (safe_page - 1) * page_size
    end = start + page_size
    return (
        items[start:end],
        PaginationMeta(page=safe_page, pageSize=page_size, total=total, totalPages=total_pages),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    user = auth_service.authenticate(payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return LoginResponse(
        accessToken=auth_service.create_access_token(user),
        expiresInSeconds=TOKEN_TTL_SECONDS,
        user=auth_service.to_public_user(user),
    )


@app.get("/api/auth/session")
def auth_session(claims: dict = Depends(require_authenticated_payload)):
    return {
        "authenticated": True,
        "subject": claims.get("sub"),
        "email": claims.get("email"),
        "roles": claims.get("roles", []),
        "exp": claims.get("exp"),
    }


@app.get("/api/agents", response_model=list[Agent])
def list_agents(_: dict = Depends(require_authenticated_payload)):
    return repo.read_list("agents.json", Agent)


@app.get("/api/product-plans", response_model=list[ProductPlan])
def list_product_plans(_: dict = Depends(require_authenticated_payload)):
    return repo.read_list("product_plans.json", ProductPlan)


@app.get("/api/policies", response_model=PoliciesPage)
def list_policies(
    agent_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    product_type: str | None = Query(default=None, alias="productType"),
    owner_query: str | None = Query(default=None, alias="owner"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, alias="pageSize", ge=1, le=100),
    _: dict = Depends(require_authenticated_payload),
):
    policies = repo.read_list("policies.json", Policy)
    plans = {plan.id: plan for plan in repo.read_list("product_plans.json", ProductPlan)}

    filtered = []
    for policy in policies:
        if agent_id and policy.agentId != agent_id:
            continue
        if status_filter and policy.status != status_filter:
            continue
        if product_type:
            plan = plans.get(policy.planId)
            if plan is None or plan.productType != product_type:
                continue
        if owner_query and owner_query.lower() not in policy.owner.fullName.lower():
            continue
        filtered.append(policy)

    items, meta = paginate_items(filtered, page=page, page_size=page_size)
    return PoliciesPage(items=items, meta=meta)


@app.get("/api/policies/{policy_id}", response_model=Policy)
def get_policy(policy_id: str, _: dict = Depends(require_authenticated_payload)):
    return require_policy(policy_id)


@app.get("/api/policies/{policy_id}/events", response_model=PolicyEventsPage)
def get_policy_events(
    policy_id: str,
    event_type: str | None = Query(default=None, alias="eventType"),
    source: str | None = Query(default=None),
    from_date: date | None = Query(default=None, alias="fromDate"),
    to_date: date | None = Query(default=None, alias="toDate"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    _: dict = Depends(require_authenticated_payload),
):
    require_policy(policy_id)
    events = ordered_policy_events(policy_id)
    filtered: list[PolicyEvent] = []
    for event in events:
        if event_type and event.eventType != event_type:
            continue
        if source and event.source != source:
            continue
        if from_date and event.effectiveDate < from_date:
            continue
        if to_date and event.effectiveDate > to_date:
            continue
        filtered.append(event)

    items, meta = paginate_items(filtered, page=page, page_size=page_size)
    return PolicyEventsPage(items=items, meta=meta)


@app.post("/api/policies/{policy_id}/events", response_model=PolicyEvent, status_code=status.HTTP_201_CREATED)
def create_policy_event(
    policy_id: str,
    payload: PolicyEventCreate,
    request: Request,
    _: dict = Depends(require_authenticated_payload),
):
    enforce_write_rate_limit(request)
    require_policy(policy_id)

    existing = repo.read_list("policy_events.json", PolicyEvent)
    new_event = PolicyEvent(
        id=f"evt_api_{int(time.time() * 1000)}",
        policyId=policy_id,
        eventType=payload.eventType,
        effectiveDate=payload.effectiveDate,
        payload=payload.payload.model_dump(mode="json"),
        source="api",
    )
    existing.append(new_event)
    repo.write_list("policy_events.json", existing)
    return new_event


@app.post("/api/policies/{policy_id}/projection", response_model=ProjectionSnapshot)
def create_projection(
    policy_id: str,
    payload: ProjectionRequest,
    _: dict = Depends(require_authenticated_payload),
):
    policy = require_policy(policy_id)
    plan = require_plan(policy.planId)
    events = ordered_policy_events(policy_id)
    hypothetical_events = [
        PolicyEvent(
            id=f"evt_hyp_{index}",
            policyId=policy_id,
            eventType=item.eventType,
            effectiveDate=item.effectiveDate,
            payload=item.payload.model_dump(mode="json"),
            source="api",
        )
        for index, item in enumerate(payload.hypotheticalEvents, start=1)
    ]
    projection = projection_engine.project(
        policy=policy,
        plan=plan,
        events=events,
        as_of_date=payload.asOfDate,
        include_loan_events=payload.includeLoanEvents,
        hypothetical_events=hypothetical_events,
    )
    return ProjectionSnapshot.model_validate(projection)
