from datetime import date
import json
from pathlib import Path

from app.models import Policy, PolicyEvent, ProductPlan
from app.projection_engine import ProjectionEngine


def _ul_policy() -> Policy:
    return Policy.model_validate(
        {
            "id": "pol_ul_1001",
            "policyNumber": "UL-9001001",
            "agentId": "agt_001",
            "owner": {"fullName": "Owner", "dob": "1985-01-01"},
            "insured": {"fullName": "Owner", "dob": "1985-01-01", "ratingClass": "Preferred"},
            "planId": "plan_ul_flex_v1",
            "issueDate": "2025-01-01",
            "faceAmount": 250000,
            "status": "inforce",
        }
    )


def _ul_plan() -> ProductPlan:
    return ProductPlan.model_validate(
        {
            "id": "plan_ul_flex_v1",
            "code": "UL-FLEX-01",
            "productType": "UNIVERSAL_LIFE",
            "params": {
                "defaultMonthlyPremium": 100,
                "interestCreditRateAnnual": 0.045,
                "monthlyAdministrativeFee": 10,
                "costOfInsuranceRateMonthly": 0.0002,
                "surrenderChargeFlat": 120,
            },
            "effectiveFrom": "2025-01-01",
            "version": "2026.01",
        }
    )


def test_projection_replay_is_deterministic_for_same_input() -> None:
    engine = ProjectionEngine()
    policy = _ul_policy()
    plan = _ul_plan()
    events = [
        PolicyEvent.model_validate(
            {
                "id": "evt_2",
                "policyId": policy.id,
                "eventType": "MONTHLY_FEE_ASSESSED",
                "effectiveDate": "2025-01-31",
                "payload": {"amount": 10},
                "source": "seed",
            }
        ),
        PolicyEvent.model_validate(
            {
                "id": "evt_1",
                "policyId": policy.id,
                "eventType": "PREMIUM_PAID",
                "effectiveDate": "2025-01-15",
                "payload": {"amount": 1000, "mode": "single"},
                "source": "seed",
            }
        ),
    ]

    snapshot_a = engine.project(policy=policy, plan=plan, events=events, as_of_date=date(2025, 12, 31))
    snapshot_b = engine.project(policy=policy, plan=plan, events=events, as_of_date=date(2025, 12, 31))

    assert snapshot_a == snapshot_b
    assert snapshot_a["appliedEvents"][0]["eventId"] == "evt_1"
    assert snapshot_a["values"]["cashValue"] >= 0


def test_term_projection_keeps_zero_cash_value() -> None:
    engine = ProjectionEngine()
    policy = Policy.model_validate(
        {
            "id": "pol_term_2001",
            "policyNumber": "TM-9002001",
            "agentId": "agt_001",
            "owner": {"fullName": "Owner", "dob": "1985-01-01"},
            "insured": {"fullName": "Owner", "dob": "1985-01-01", "ratingClass": "Preferred"},
            "planId": "plan_term_20_std_v1",
            "issueDate": "2025-01-01",
            "faceAmount": 500000,
            "status": "inforce",
        }
    )
    plan = ProductPlan.model_validate(
        {
            "id": "plan_term_20_std_v1",
            "code": "TERM-20-STD",
            "productType": "TERM_LIFE",
            "params": {"monthlyPremium": 45},
            "effectiveFrom": "2025-01-01",
            "version": "2026.01",
        }
    )

    snapshot = engine.project(policy=policy, plan=plan, events=[], as_of_date=date(2025, 12, 31))

    assert snapshot["values"]["cashValue"] == 0
    assert snapshot["values"]["surrenderValue"] == 0
    assert snapshot["values"]["deathBenefit"] == 500000


def test_ul_projection_changes_over_time_with_monthly_cycle() -> None:
    engine = ProjectionEngine()
    policy = _ul_policy()
    plan = _ul_plan()
    events: list[PolicyEvent] = []

    early = engine.project(policy=policy, plan=plan, events=events, as_of_date=date(2025, 1, 31))
    later = engine.project(policy=policy, plan=plan, events=events, as_of_date=date(2025, 6, 30))

    assert later["values"]["cashValue"] != early["values"]["cashValue"]
    assert any(item["eventType"] == "SYSTEM_MONTHLY_CYCLE" for item in later["appliedEvents"])


def test_iul_projection_uses_index_crediting_with_floor_and_cap() -> None:
    engine = ProjectionEngine()
    policy = Policy.model_validate(
        {
            "id": "pol_iul_1",
            "policyNumber": "IU-1",
            "agentId": "agt_001",
            "owner": {"fullName": "Owner", "dob": "1980-01-01"},
            "insured": {"fullName": "Owner", "dob": "1980-01-01", "ratingClass": "Preferred"},
            "planId": "plan_iul_index_v1",
            "issueDate": "2025-01-01",
            "faceAmount": 300000,
            "status": "inforce",
        }
    )
    plan = ProductPlan.model_validate(
        {
            "id": "plan_iul_index_v1",
            "code": "IUL-SP500-01",
            "productType": "INDEXED_UNIVERSAL_LIFE",
            "params": {
                "defaultMonthlyPremium": 120,
                "monthlyAdministrativeFee": 12,
                "costOfInsuranceRateMonthly": 0.0002,
                "indexParticipationRate": 0.9,
                "indexCapRateAnnual": 0.12,
                "indexFloorRateAnnual": 0.0,
                "indexReturnSeriesMonthly": {
                    "2025-01": 0.20,  # capped by annual cap
                    "2025-02": -0.20,  # floored at 0
                },
            },
            "effectiveFrom": "2025-01-01",
            "version": "2026.01",
        }
    )

    snapshot = engine.project(policy=policy, plan=plan, events=[], as_of_date=date(2025, 2, 28))

    assert snapshot["assumptions"]["creditingMethod"] == "index-linked"
    assert snapshot["values"]["cashValue"] > 0
    assert any(item["eventType"] == "SYSTEM_MONTHLY_CYCLE" for item in snapshot["appliedEvents"])


def _golden() -> dict:
    path = Path(__file__).resolve().parent / "golden" / "projection_golden.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_projection_matches_golden_ul_snapshot() -> None:
    engine = ProjectionEngine()
    policy = _ul_policy()
    plan = _ul_plan()
    events = [
        PolicyEvent.model_validate(
            {
                "id": "evt_2",
                "policyId": policy.id,
                "eventType": "MONTHLY_FEE_ASSESSED",
                "effectiveDate": "2025-01-31",
                "payload": {"amount": 10},
                "source": "seed",
            }
        ),
        PolicyEvent.model_validate(
            {
                "id": "evt_1",
                "policyId": policy.id,
                "eventType": "PREMIUM_PAID",
                "effectiveDate": "2025-01-15",
                "payload": {"amount": 1000, "mode": "single"},
                "source": "seed",
            }
        ),
    ]
    snapshot = engine.project(policy=policy, plan=plan, events=events, as_of_date=date(2025, 12, 31))
    expected = _golden()["ul_replay_2025_12_31"]

    assert snapshot["asOfDate"] == expected["asOfDate"]
    assert snapshot["values"] == expected["values"]
    assert len(snapshot["appliedEvents"]) == expected["appliedEventsCount"]
    assert snapshot["appliedEvents"][-1]["running"] == expected["lastRunning"]


def test_projection_matches_golden_iul_snapshot() -> None:
    engine = ProjectionEngine()
    policy = Policy.model_validate(
        {
            "id": "pol_iul_1",
            "policyNumber": "IU-1",
            "agentId": "agt_001",
            "owner": {"fullName": "Owner", "dob": "1980-01-01"},
            "insured": {"fullName": "Owner", "dob": "1980-01-01", "ratingClass": "Preferred"},
            "planId": "plan_iul_index_v1",
            "issueDate": "2025-01-01",
            "faceAmount": 300000,
            "status": "inforce",
        }
    )
    plan = ProductPlan.model_validate(
        {
            "id": "plan_iul_index_v1",
            "code": "IUL-SP500-01",
            "productType": "INDEXED_UNIVERSAL_LIFE",
            "params": {
                "defaultMonthlyPremium": 120,
                "monthlyAdministrativeFee": 12,
                "costOfInsuranceRateMonthly": 0.0002,
                "indexParticipationRate": 0.9,
                "indexCapRateAnnual": 0.12,
                "indexFloorRateAnnual": 0.0,
                "indexReturnSeriesMonthly": {"2025-01": 0.20, "2025-02": -0.20},
            },
            "effectiveFrom": "2025-01-01",
            "version": "2026.01",
        }
    )
    snapshot = engine.project(policy=policy, plan=plan, events=[], as_of_date=date(2025, 2, 28))
    expected = _golden()["iul_replay_2025_02_28"]

    assert snapshot["asOfDate"] == expected["asOfDate"]
    assert snapshot["values"] == expected["values"]
    assert len(snapshot["appliedEvents"]) == expected["appliedEventsCount"]
    assert snapshot["appliedEvents"][0]["delta"] == expected["firstEventDelta"]
