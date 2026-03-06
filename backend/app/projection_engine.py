from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.models import Policy, PolicyEvent, ProductPlan

RULE_VERSION = "projection-rules-v1"


@dataclass
class ReplayState:
    premium_paid: float = 0.0
    cash_value: float = 0.0
    loan_balance: float = 0.0
    charges_assessed: float = 0.0
    death_benefit_basis: float = 0.0
    status: str = "inforce"
    warnings: list[str] = field(default_factory=list)


class ProductStrategy:
    def apply_explicit_event(self, event: PolicyEvent, state: ReplayState, policy: Policy, plan: ProductPlan) -> dict[str, float]:
        raise NotImplementedError

    def apply_monthly_cycle(
        self,
        month_key: str,
        explicit_event_types: set[str],
        state: ReplayState,
        policy: Policy,
        plan: ProductPlan,
    ) -> dict[str, float]:
        return {}

    def assumptions(self, plan: ProductPlan) -> dict[str, Any]:
        return {
            "productType": plan.productType,
            "planCode": plan.code,
            "planVersion": plan.version,
            "projectionCurrency": "USD",
            "ruleVersion": RULE_VERSION,
            "scheduledMonthlyCycle": True,
            "assumedPremiumMode": "apply-when-missing-premium-event",
        }

    def finalize_values(self, policy: Policy, plan: ProductPlan, state: ReplayState) -> dict[str, Any]:
        raise NotImplementedError


class TermStrategy(ProductStrategy):
    def apply_explicit_event(self, event: PolicyEvent, state: ReplayState, policy: Policy, plan: ProductPlan) -> dict[str, float]:
        delta: dict[str, float] = {}
        if event.eventType == "PREMIUM_PAID":
            amount = float(event.payload.get("amount", 0))
            state.premium_paid += amount
            delta["premiumPaid"] = round(amount, 2)
        elif event.eventType in {"LOAN_TAKEN", "LOAN_REPAID"}:
            state.warnings.append("Loan events are ignored for term life under projection-rules-v1.")
        elif event.eventType == "MONTHLY_FEE_ASSESSED":
            amount = float(event.payload.get("amount", 0))
            state.charges_assessed += amount
            delta["chargesAssessed"] = round(amount, 2)
        return delta

    def apply_monthly_cycle(
        self,
        month_key: str,
        explicit_event_types: set[str],
        state: ReplayState,
        policy: Policy,
        plan: ProductPlan,
    ) -> dict[str, float]:
        delta: dict[str, float] = {}
        if "PREMIUM_PAID" not in explicit_event_types:
            monthly_premium = float(plan.params.get("monthlyPremium", 0))
            if monthly_premium > 0:
                state.premium_paid += monthly_premium
                delta["premiumPaid"] = round(monthly_premium, 2)
        return delta

    def assumptions(self, plan: ProductPlan) -> dict[str, Any]:
        base = super().assumptions(plan)
        return {**base, "scheduledMonthlyPremium": plan.params.get("monthlyPremium", 0)}

    def finalize_values(self, policy: Policy, plan: ProductPlan, state: ReplayState) -> dict[str, Any]:
        state.warnings.append("Term life plan does not accumulate cash value under projection-rules-v1.")
        return {
            "cashValue": 0,
            "surrenderValue": 0,
            "deathBenefit": round(policy.faceAmount, 2),
            "loanBalance": 0,
            "status": policy.status,
        }


class WholeLifeStrategy(ProductStrategy):
    def apply_explicit_event(self, event: PolicyEvent, state: ReplayState, policy: Policy, plan: ProductPlan) -> dict[str, float]:
        delta: dict[str, float] = {}
        if event.eventType == "PREMIUM_PAID":
            amount = float(event.payload.get("amount", 0))
            credited = amount * 0.85
            state.premium_paid += amount
            state.cash_value += credited
            delta["premiumPaid"] = round(amount, 2)
            delta["cashValue"] = round(credited, 2)
        elif event.eventType == "MONTHLY_FEE_ASSESSED":
            amount = float(event.payload.get("amount", 0))
            state.charges_assessed += amount
            state.cash_value -= amount
            delta["chargesAssessed"] = round(amount, 2)
            delta["cashValue"] = round(-amount, 2)
        elif event.eventType == "INTEREST_CREDITED":
            credited = float(event.payload.get("creditedAmount", 0))
            if credited == 0:
                rate = float(event.payload.get("rateAnnual", plan.params.get("guaranteedCreditRateAnnual", 0.03)))
                credited = state.cash_value * (rate / 12)
            state.cash_value += credited
            delta["cashValue"] = round(credited, 2)
        elif event.eventType == "LOAN_TAKEN":
            amount = min(float(event.payload.get("amount", 0)), max(state.cash_value, 0))
            state.loan_balance += amount
            state.cash_value -= amount
            delta["loanBalance"] = round(amount, 2)
            delta["cashValue"] = round(-amount, 2)
        elif event.eventType == "LOAN_REPAID":
            amount = float(event.payload.get("amount", 0))
            repaid = min(amount, state.loan_balance)
            state.loan_balance -= repaid
            delta["loanBalance"] = round(-repaid, 2)
        elif event.eventType == "RIDER_CHANGED":
            monthly_charge = float(event.payload.get("monthlyCharge", 0))
            if event.payload.get("action") == "add":
                state.charges_assessed += monthly_charge
                state.cash_value -= monthly_charge
                delta["chargesAssessed"] = round(monthly_charge, 2)
                delta["cashValue"] = round(-monthly_charge, 2)

        state.cash_value = max(state.cash_value, 0)
        return delta

    def apply_monthly_cycle(
        self,
        month_key: str,
        explicit_event_types: set[str],
        state: ReplayState,
        policy: Policy,
        plan: ProductPlan,
    ) -> dict[str, float]:
        delta: dict[str, float] = {}
        if "PREMIUM_PAID" not in explicit_event_types:
            monthly_premium = float(plan.params.get("monthlyPremium", 0))
            if monthly_premium > 0:
                credited = monthly_premium * 0.85
                state.premium_paid += monthly_premium
                state.cash_value += credited
                delta["premiumPaid"] = round(monthly_premium, 2)
                delta["cashValue"] = round(credited, 2)

        if "INTEREST_CREDITED" not in explicit_event_types:
            guaranteed_rate = float(plan.params.get("guaranteedCreditRateAnnual", 0.0))
            credit = state.cash_value * (guaranteed_rate / 12)
            if credit != 0:
                state.cash_value += credit
                delta["cashValue"] = round(delta.get("cashValue", 0) + credit, 2)

        state.cash_value = max(state.cash_value, 0)
        return delta

    def assumptions(self, plan: ProductPlan) -> dict[str, Any]:
        base = super().assumptions(plan)
        return {
            **base,
            "scheduledMonthlyPremium": plan.params.get("monthlyPremium", 0),
            "guaranteedCreditRateAnnual": plan.params.get("guaranteedCreditRateAnnual", 0.0),
        }

    def finalize_values(self, policy: Policy, plan: ProductPlan, state: ReplayState) -> dict[str, Any]:
        surrender_charge = float(plan.params.get("surrenderChargeFlat", 0))
        death_benefit = policy.faceAmount + max(state.cash_value * 0.1, 0)
        return {
            "cashValue": round(state.cash_value, 2),
            "surrenderValue": round(max(state.cash_value - surrender_charge, 0), 2),
            "deathBenefit": round(death_benefit, 2),
            "loanBalance": round(state.loan_balance, 2),
            "status": policy.status,
        }


class UniversalLifeStrategy(ProductStrategy):
    def apply_explicit_event(self, event: PolicyEvent, state: ReplayState, policy: Policy, plan: ProductPlan) -> dict[str, float]:
        delta: dict[str, float] = {}
        if event.eventType == "PREMIUM_PAID":
            amount = float(event.payload.get("amount", 0))
            state.premium_paid += amount
            state.cash_value += amount
            delta["premiumPaid"] = round(amount, 2)
            delta["cashValue"] = round(amount, 2)
        elif event.eventType == "MONTHLY_FEE_ASSESSED":
            amount = float(event.payload.get("amount", plan.params.get("monthlyAdministrativeFee", 0)))
            state.charges_assessed += amount
            state.cash_value -= amount
            delta["chargesAssessed"] = round(amount, 2)
            delta["cashValue"] = round(-amount, 2)
        elif event.eventType == "INTEREST_CREDITED":
            credited = float(event.payload.get("creditedAmount", 0))
            if credited == 0:
                rate = float(event.payload.get("rateAnnual", plan.params.get("interestCreditRateAnnual", 0.04)))
                credited = state.cash_value * (rate / 12)
            state.cash_value += credited
            delta["cashValue"] = round(credited, 2)
        elif event.eventType == "LOAN_TAKEN":
            amount = min(float(event.payload.get("amount", 0)), max(state.cash_value, 0))
            state.loan_balance += amount
            state.cash_value -= amount
            delta["loanBalance"] = round(amount, 2)
            delta["cashValue"] = round(-amount, 2)
        elif event.eventType == "LOAN_REPAID":
            amount = float(event.payload.get("amount", 0))
            repaid = min(amount, state.loan_balance)
            state.loan_balance -= repaid
            state.cash_value += max(amount - repaid, 0)
            delta["loanBalance"] = round(-repaid, 2)
            if amount > repaid:
                delta["cashValue"] = round(amount - repaid, 2)
        elif event.eventType == "RIDER_CHANGED":
            monthly_charge = float(event.payload.get("monthlyCharge", 0))
            if event.payload.get("action") == "add":
                state.charges_assessed += monthly_charge
                state.cash_value -= monthly_charge
                delta["chargesAssessed"] = round(monthly_charge, 2)
                delta["cashValue"] = round(-monthly_charge, 2)

        if state.cash_value < 0:
            state.warnings.append("Cash value dropped below zero; clamped to zero.")
            state.cash_value = 0
        return delta

    def apply_monthly_cycle(
        self,
        month_key: str,
        explicit_event_types: set[str],
        state: ReplayState,
        policy: Policy,
        plan: ProductPlan,
    ) -> dict[str, float]:
        delta: dict[str, float] = {}

        if "PREMIUM_PAID" not in explicit_event_types:
            monthly_premium = float(plan.params.get("defaultMonthlyPremium", 0))
            if monthly_premium > 0:
                state.premium_paid += monthly_premium
                state.cash_value += monthly_premium
                delta["premiumPaid"] = round(monthly_premium, 2)
                delta["cashValue"] = round(monthly_premium, 2)

        if "MONTHLY_FEE_ASSESSED" not in explicit_event_types:
            admin_fee = float(plan.params.get("monthlyAdministrativeFee", 0))
            coi_rate = float(plan.params.get("costOfInsuranceRateMonthly", 0))
            coi_charge = policy.faceAmount * coi_rate
            total_charge = admin_fee + coi_charge
            if total_charge != 0:
                state.charges_assessed += total_charge
                state.cash_value -= total_charge
                delta["chargesAssessed"] = round(delta.get("chargesAssessed", 0) + total_charge, 2)
                delta["cashValue"] = round(delta.get("cashValue", 0) - total_charge, 2)

        if "INTEREST_CREDITED" not in explicit_event_types:
            interest_rate = float(plan.params.get("interestCreditRateAnnual", 0))
            credited = max(state.cash_value, 0) * (interest_rate / 12)
            if credited != 0:
                state.cash_value += credited
                delta["cashValue"] = round(delta.get("cashValue", 0) + credited, 2)

        if state.cash_value < 0:
            state.warnings.append("Cash value dropped below zero; clamped to zero.")
            state.cash_value = 0
        return delta

    def assumptions(self, plan: ProductPlan) -> dict[str, Any]:
        base = super().assumptions(plan)
        return {
            **base,
            "scheduledMonthlyPremium": plan.params.get("defaultMonthlyPremium", 0),
            "interestCreditRateAnnual": plan.params.get("interestCreditRateAnnual", 0.0),
            "monthlyAdministrativeFee": plan.params.get("monthlyAdministrativeFee", 0.0),
            "costOfInsuranceRateMonthly": plan.params.get("costOfInsuranceRateMonthly", 0.0),
        }

    def finalize_values(self, policy: Policy, plan: ProductPlan, state: ReplayState) -> dict[str, Any]:
        surrender_charge = float(plan.params.get("surrenderChargeFlat", 0))
        death_benefit = policy.faceAmount + state.cash_value - state.loan_balance
        return {
            "cashValue": round(state.cash_value, 2),
            "surrenderValue": round(max(state.cash_value - surrender_charge, 0), 2),
            "deathBenefit": round(max(death_benefit, 0), 2),
            "loanBalance": round(state.loan_balance, 2),
            "status": policy.status,
        }


class IndexedUniversalLifeStrategy(UniversalLifeStrategy):
    @staticmethod
    def _index_rate_for_month(month_key: str, plan: ProductPlan) -> float:
        series = plan.params.get("indexReturnSeriesMonthly", {})
        if isinstance(series, dict):
            raw = series.get(month_key)
            if isinstance(raw, (int, float)):
                return float(raw)

        # Deterministic fallback with bullish demo bias while retaining down months.
        checksum = sum(ord(char) for char in f"{plan.id}:{month_key}")
        drift = float(plan.params.get("indexReturnFallbackDriftMonthly", 0.006))
        amplitude = float(plan.params.get("indexReturnFallbackAmplitudeMonthly", 0.008))
        wave = ((checksum % 17) - 8) / 8
        return drift + (amplitude * wave)

    def apply_monthly_cycle(
        self,
        month_key: str,
        explicit_event_types: set[str],
        state: ReplayState,
        policy: Policy,
        plan: ProductPlan,
    ) -> dict[str, float]:
        delta: dict[str, float] = {}

        if "PREMIUM_PAID" not in explicit_event_types:
            monthly_premium = float(plan.params.get("defaultMonthlyPremium", 0))
            if monthly_premium > 0:
                state.premium_paid += monthly_premium
                state.cash_value += monthly_premium
                delta["premiumPaid"] = round(monthly_premium, 2)
                delta["cashValue"] = round(monthly_premium, 2)

        if "MONTHLY_FEE_ASSESSED" not in explicit_event_types:
            admin_fee = float(plan.params.get("monthlyAdministrativeFee", 0))
            coi_rate = float(plan.params.get("costOfInsuranceRateMonthly", 0))
            coi_charge = policy.faceAmount * coi_rate
            total_charge = admin_fee + coi_charge
            if total_charge != 0:
                state.charges_assessed += total_charge
                state.cash_value -= total_charge
                delta["chargesAssessed"] = round(delta.get("chargesAssessed", 0) + total_charge, 2)
                delta["cashValue"] = round(delta.get("cashValue", 0) - total_charge, 2)

        if "INTEREST_CREDITED" not in explicit_event_types:
            raw_index_return = self._index_rate_for_month(month_key, plan)
            participation = float(plan.params.get("indexParticipationRate", 1.0))
            cap_annual = float(plan.params.get("indexCapRateAnnual", 0.12))
            floor_annual = float(plan.params.get("indexFloorRateAnnual", 0.0))
            cap_monthly = cap_annual / 12
            floor_monthly = floor_annual / 12
            credited_rate = min(max(raw_index_return * participation, floor_monthly), cap_monthly)
            credited_amount = max(state.cash_value, 0) * credited_rate
            if credited_amount != 0:
                state.cash_value += credited_amount
                delta["cashValue"] = round(delta.get("cashValue", 0) + credited_amount, 2)
                delta["indexCreditRateApplied"] = round(credited_rate, 6)
                delta["indexReturnRaw"] = round(raw_index_return, 6)

        if state.cash_value < 0:
            state.warnings.append("Cash value dropped below zero; clamped to zero.")
            state.cash_value = 0
        return delta

    def assumptions(self, plan: ProductPlan) -> dict[str, Any]:
        base = super().assumptions(plan)
        return {
            **base,
            "creditingMethod": "index-linked",
            "indexName": plan.params.get("indexName", "S&P 500"),
            "indexParticipationRate": plan.params.get("indexParticipationRate", 1.0),
            "indexCapRateAnnual": plan.params.get("indexCapRateAnnual", 0.12),
            "indexFloorRateAnnual": plan.params.get("indexFloorRateAnnual", 0.0),
        }


STRATEGIES: dict[str, ProductStrategy] = {
    "TERM_LIFE": TermStrategy(),
    "WHOLE_LIFE": WholeLifeStrategy(),
    "UNIVERSAL_LIFE": UniversalLifeStrategy(),
    "INDEXED_UNIVERSAL_LIFE": IndexedUniversalLifeStrategy(),
}


def _month_end(day: date) -> date:
    if day.month == 12:
        return date(day.year, 12, 31)
    return date(day.year, day.month + 1, 1) - timedelta(days=1)


def _month_sequence(start: date, end: date) -> list[date]:
    if start > end:
        return []

    cursor = date(start.year, start.month, 1)
    months: list[date] = []
    while cursor <= end:
        months.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


class ProjectionEngine:
    def project(
        self,
        policy: Policy,
        plan: ProductPlan,
        events: list[PolicyEvent],
        as_of_date: date,
        include_loan_events: bool = True,
        hypothetical_events: list[PolicyEvent] | None = None,
    ) -> dict[str, Any]:
        strategy = STRATEGIES[plan.productType]
        state = ReplayState(status=policy.status, death_benefit_basis=policy.faceAmount)
        applied_events: list[dict[str, Any]] = []

        scoped_events = [event for event in events if event.effectiveDate <= as_of_date]
        if not include_loan_events:
            scoped_events = [
                event
                for event in scoped_events
                if event.eventType not in {"LOAN_TAKEN", "LOAN_REPAID"}
            ]
            state.warnings.append("Existing loan events excluded by request.")

        if hypothetical_events:
            scoped_events.extend(
                [event for event in hypothetical_events if event.effectiveDate <= as_of_date]
            )
            state.warnings.append("Projection includes theoretical events (not persisted).")
        scoped_events.sort(key=lambda item: (item.effectiveDate, item.id))

        explicit_by_month: dict[str, set[str]] = {}
        for event in scoped_events:
            month_key = f"{event.effectiveDate.year:04d}-{event.effectiveDate.month:02d}"
            explicit_by_month.setdefault(month_key, set()).add(event.eventType)

        timeline: list[tuple[date, int, str, str, Any]] = []
        for event in scoped_events:
            timeline.append((event.effectiveDate, 0, event.id, "explicit", event))

        schedule_start = max(policy.issueDate, plan.effectiveFrom)
        for month_start in _month_sequence(schedule_start, as_of_date):
            cycle_date = _month_end(month_start)
            if cycle_date < schedule_start or cycle_date > as_of_date:
                continue
            month_key = f"{month_start.year:04d}-{month_start.month:02d}"
            timeline.append((cycle_date, 1, f"sys_cycle_{month_key}", "cycle", month_key))

        timeline.sort(key=lambda row: (row[0], row[1], row[2]))

        for effective_day, _, item_id, item_kind, payload in timeline:
            if item_kind == "explicit":
                event: PolicyEvent = payload
                delta = strategy.apply_explicit_event(event, state, policy, plan)
                if not delta:
                    continue
                event_type = event.eventType
                event_id = event.id
            else:
                month_key: str = payload
                delta = strategy.apply_monthly_cycle(
                    month_key=month_key,
                    explicit_event_types=explicit_by_month.get(month_key, set()),
                    state=state,
                    policy=policy,
                    plan=plan,
                )
                if not delta:
                    continue
                event_type = "SYSTEM_MONTHLY_CYCLE"
                event_id = item_id

            applied_events.append(
                {
                    "eventId": event_id,
                    "eventType": event_type,
                    "effectiveDate": effective_day.isoformat(),
                    "delta": delta,
                    "running": {
                        "cashValue": round(state.cash_value, 2),
                        "loanBalance": round(state.loan_balance, 2),
                        "premiumPaid": round(state.premium_paid, 2),
                        "chargesAssessed": round(state.charges_assessed, 2),
                    },
                }
            )

        values = strategy.finalize_values(policy, plan, state)
        assumptions = strategy.assumptions(plan)

        return {
            "policyId": policy.id,
            "asOfDate": as_of_date.isoformat(),
            "values": values,
            "assumptions": assumptions,
            "appliedEvents": applied_events,
            "warnings": sorted(set(state.warnings)),
        }
