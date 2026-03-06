import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProjectionSnapshot } from "../domain/projection/types";
import { ApiError } from "../lib/api";
import { Policy, PolicyEventCreate, ProductPlan, fetchPolicies, fetchProductPlans, projectPolicy } from "../lib/pasApi";

type TrendPoint = {
  date: string;
  label: string;
  cashValue: number;
  surrenderValue: number;
  deathBenefit: number;
  loanBalance: number;
};

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonths(value: Date, months: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + months, value.getDate());
}

function addYears(value: Date, years: number): Date {
  return new Date(value.getFullYear() + years, value.getMonth(), value.getDate());
}

function clampTargetDate(candidateIso: string, minIso: string): string {
  const candidate = parseIsoDate(candidateIso);
  const minimum = parseIsoDate(minIso);
  if (Number.isNaN(candidate.getTime())) {
    return minIso;
  }
  return candidate < minimum ? minIso : candidateIso;
}

function buildProjectionDates(startIso: string, targetIso: string): string[] {
  const start = parseIsoDate(startIso);
  const minEnd = addYears(start, 1);
  const target = parseIsoDate(targetIso);
  const end = target > minEnd ? target : minEnd;
  const dates: string[] = [formatIsoDate(start)];
  let cursor = addMonths(start, 1);
  while (cursor < end) {
    dates.push(formatIsoDate(cursor));
    cursor = addMonths(cursor, 1);
  }
  const endIso = formatIsoDate(end);
  if (dates[dates.length - 1] !== endIso) {
    dates.push(endIso);
  }
  return dates;
}

function formatAxisDate(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`;
}

export function useProjection() {
  const defaultProductType = "INDEXED_UNIVERSAL_LIFE";
  const todayIso = useMemo(() => formatIsoDate(new Date()), []);
  const defaultTargetIso = useMemo(() => formatIsoDate(addYears(parseIsoDate(todayIso), 30)), [todayIso]);
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [productTypeFilter, setProductTypeFilter] = useState("ALL");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [asOfDate, setAsOfDate] = useState(defaultTargetIso);
  const [projection, setProjection] = useState<ProjectionSnapshot | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [includeLoanEvents, setIncludeLoanEvents] = useState(false);
  const [hypotheticalEvents, setHypotheticalEvents] = useState<PolicyEventCreate[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isProjecting, setIsProjecting] = useState(false);
  const [isLoadingTrend, setIsLoadingTrend] = useState(false);

  useEffect(() => {
    const clamped = clampTargetDate(asOfDate, todayIso);
    if (clamped !== asOfDate) {
      setAsOfDate(clamped);
    }
  }, [asOfDate, todayIso]);

  useEffect(() => {
    if (productTypeFilter !== "ALL") return;
    const hasDefaultProduct = plans.some((plan) => plan.productType === defaultProductType);
    if (hasDefaultProduct) {
      setProductTypeFilter(defaultProductType);
    }
  }, [defaultProductType, plans, productTypeFilter]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError("");
      try {
        const [policyData, planData] = await Promise.all([
          fetchPolicies({ page: 1, pageSize: 100 }),
          fetchProductPlans(),
        ]);
        setPolicies(policyData.items);
        setPlans(planData);
      } catch (requestError) {
        if (requestError instanceof ApiError) {
          setError(requestError.message);
        } else {
          setError("Unable to load time-machine inputs.");
        }
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const productTypeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const plan of plans) {
      unique.add(plan.productType);
    }
    return ["ALL", ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [plans]);

  const filteredPolicies = useMemo(() => {
    if (productTypeFilter === "ALL") return policies;
    return policies.filter((policy) => planById.get(policy.planId)?.productType === productTypeFilter);
  }, [planById, policies, productTypeFilter]);

  useEffect(() => {
    if (filteredPolicies.length === 0) {
      if (selectedPolicyId !== "") setSelectedPolicyId("");
      return;
    }
    const stillValid = filteredPolicies.some((policy) => policy.id === selectedPolicyId);
    if (!stillValid) setSelectedPolicyId(filteredPolicies[0].id);
  }, [filteredPolicies, selectedPolicyId]);

  useEffect(() => {
    const loadTrend = async () => {
      if (!selectedPolicyId) return;
      setIsLoadingTrend(true);
      setError("");
      try {
        const dates = buildProjectionDates(todayIso, asOfDate);
        const snapshots = await Promise.all(
          dates.map((date) =>
            projectPolicy(selectedPolicyId, date, {
              includeLoanEvents,
              hypotheticalEvents,
            }),
          ),
        );
        setTrendPoints(
          snapshots.map((snapshot) => ({
            date: snapshot.asOfDate,
            label: formatAxisDate(snapshot.asOfDate),
            cashValue: snapshot.values.cashValue,
            surrenderValue: snapshot.values.surrenderValue,
            deathBenefit: snapshot.values.deathBenefit,
            loanBalance: snapshot.values.loanBalance,
          })),
        );
        setProjection(snapshots[snapshots.length - 1]);
      } catch (requestError) {
        if (requestError instanceof ApiError) {
          setError(requestError.message);
        } else {
          setError("Unable to load projection trend.");
        }
      } finally {
        setIsLoadingTrend(false);
      }
    };
    void loadTrend();
  }, [asOfDate, hypotheticalEvents, includeLoanEvents, selectedPolicyId, todayIso]);

  const runProjection = useCallback(async () => {
    if (!selectedPolicyId) return;
    setIsProjecting(true);
    setError("");
    try {
      const snapshot = await projectPolicy(selectedPolicyId, asOfDate, {
        includeLoanEvents,
        hypotheticalEvents,
      });
      setProjection(snapshot);
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message);
      } else {
        setError("Projection failed.");
      }
    } finally {
      setIsProjecting(false);
    }
  }, [asOfDate, hypotheticalEvents, includeLoanEvents, selectedPolicyId]);

  return {
    todayIso,
    plans,
    policies,
    planById,
    productTypeOptions,
    filteredPolicies,
    productTypeFilter,
    setProductTypeFilter,
    selectedPolicyId,
    setSelectedPolicyId,
    asOfDate,
    setAsOfDate,
    projection,
    trendPoints,
    includeLoanEvents,
    setIncludeLoanEvents,
    hypotheticalEvents,
    setHypotheticalEvents,
    error,
    setError,
    isLoading,
    isProjecting,
    isLoadingTrend,
    runProjection,
    clampTargetDate,
  };
}
