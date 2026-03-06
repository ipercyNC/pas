from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field


class ApiErrorDetail(BaseModel):
    field: str | None = None
    message: str


class ApiErrorBody(BaseModel):
    code: str
    message: str
    details: list[ApiErrorDetail] = Field(default_factory=list)


class ApiErrorResponse(BaseModel):
    error: ApiErrorBody


class User(BaseModel):
    id: str
    email: str
    displayName: str
    salt: str
    passwordHash: str
    roles: list[Literal["admin", "agent", "viewer"]]


class UserPublic(BaseModel):
    id: str
    email: str
    displayName: str
    roles: list[str]


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    accessToken: str
    tokenType: Literal["Bearer"] = "Bearer"
    expiresInSeconds: int
    user: UserPublic


class Agent(BaseModel):
    id: str
    name: str
    agency: str
    states: list[str]
    status: Literal["active", "inactive"]


class ProductPlan(BaseModel):
    id: str
    code: str
    productType: Literal["TERM_LIFE", "WHOLE_LIFE", "UNIVERSAL_LIFE", "INDEXED_UNIVERSAL_LIFE"]
    params: dict[str, Any] = Field(default_factory=dict)
    effectiveFrom: date
    version: str


class Party(BaseModel):
    fullName: str
    dob: date


class InsuredParty(Party):
    ratingClass: str


class Policy(BaseModel):
    id: str
    policyNumber: str
    agentId: str
    owner: Party
    insured: InsuredParty
    planId: str
    issueDate: date
    faceAmount: float
    status: Literal["pending", "inforce", "lapsed", "terminated"]


class PolicyEvent(BaseModel):
    id: str
    policyId: str
    eventType: Literal[
        "PREMIUM_PAID",
        "MONTHLY_FEE_ASSESSED",
        "INTEREST_CREDITED",
        "LOAN_TAKEN",
        "LOAN_REPAID",
        "RIDER_CHANGED",
    ]
    effectiveDate: date
    payload: dict[str, Any] = Field(default_factory=dict)
    source: Literal["seed", "api", "import"]


class PremiumPaidPayload(BaseModel):
    amount: float
    mode: str = "single"


class MonthlyFeePayload(BaseModel):
    amount: float
    reason: str = "administrative"


class InterestCreditedPayload(BaseModel):
    rateAnnual: float
    creditedAmount: float


class LoanTakenPayload(BaseModel):
    amount: float
    loanType: str = "standard"


class LoanRepaidPayload(BaseModel):
    amount: float


class RiderChangedPayload(BaseModel):
    riderCode: str
    action: Literal["add", "remove", "update"]
    monthlyCharge: float = 0


class PremiumPaidCreate(BaseModel):
    eventType: Literal["PREMIUM_PAID"]
    effectiveDate: date
    payload: PremiumPaidPayload


class MonthlyFeeAssessedCreate(BaseModel):
    eventType: Literal["MONTHLY_FEE_ASSESSED"]
    effectiveDate: date
    payload: MonthlyFeePayload


class InterestCreditedCreate(BaseModel):
    eventType: Literal["INTEREST_CREDITED"]
    effectiveDate: date
    payload: InterestCreditedPayload


class LoanTakenCreate(BaseModel):
    eventType: Literal["LOAN_TAKEN"]
    effectiveDate: date
    payload: LoanTakenPayload


class LoanRepaidCreate(BaseModel):
    eventType: Literal["LOAN_REPAID"]
    effectiveDate: date
    payload: LoanRepaidPayload


class RiderChangedCreate(BaseModel):
    eventType: Literal["RIDER_CHANGED"]
    effectiveDate: date
    payload: RiderChangedPayload


PolicyEventCreate = Annotated[
    PremiumPaidCreate
    | MonthlyFeeAssessedCreate
    | InterestCreditedCreate
    | LoanTakenCreate
    | LoanRepaidCreate
    | RiderChangedCreate,
    Field(discriminator="eventType"),
]


class ProjectionRequest(BaseModel):
    asOfDate: date
    includeLoanEvents: bool = False
    hypotheticalEvents: list[PolicyEventCreate] = Field(default_factory=list)


class ProjectionValues(BaseModel):
    cashValue: float
    surrenderValue: float
    deathBenefit: float
    loanBalance: float
    status: str


class ProjectionAppliedEvent(BaseModel):
    eventId: str
    eventType: str
    effectiveDate: date
    delta: dict[str, Any]
    running: dict[str, Any]


class ProjectionSnapshot(BaseModel):
    policyId: str
    asOfDate: date
    values: ProjectionValues
    assumptions: dict[str, Any]
    appliedEvents: list[ProjectionAppliedEvent]
    warnings: list[str]


class PaginationMeta(BaseModel):
    page: int
    pageSize: int
    total: int
    totalPages: int


class PoliciesPage(BaseModel):
    items: list[Policy]
    meta: PaginationMeta


class PolicyEventsPage(BaseModel):
    items: list[PolicyEvent]
    meta: PaginationMeta
