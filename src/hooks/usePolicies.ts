import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError } from "../lib/api";
import {
  Agent,
  PaginationMeta,
  Policy,
  PolicyEvent,
  PolicyEventCreate,
  ProductPlan,
  createPolicyEvent,
  fetchAgents,
  fetchPolicies,
  fetchPolicy,
  fetchPolicyEvents,
  fetchProductPlans,
} from "../lib/pasApi";

const DEFAULT_META: PaginationMeta = { page: 1, pageSize: 20, total: 0, totalPages: 1 };

export function usePolicies(filters: { agentId: string; status: string; productType: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policiesMeta, setPoliciesMeta] = useState<PaginationMeta>(DEFAULT_META);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [policyEvents, setPolicyEvents] = useState<PolicyEvent[]>([]);
  const [eventsMeta, setEventsMeta] = useState<PaginationMeta>(DEFAULT_META);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsTypeFilter, setEventsTypeFilter] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);
  const [policiesPage, setPoliciesPage] = useState(1);

  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const selectedPolicyId = selectedPolicy?.id ?? null;

  const loadEvents = useCallback(
    async (policyId: string, page: number, eventType: string) => {
      const [policyDetail, eventsResponse] = await Promise.all([
        fetchPolicy(policyId),
        fetchPolicyEvents(policyId, {
          page,
          pageSize: 20,
          eventType: eventType || undefined,
        }),
      ]);
      setSelectedPolicy(policyDetail);
      setPolicyEvents(eventsResponse.items);
      setEventsMeta(eventsResponse.meta);
    },
    [],
  );

  const loadPolicies = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [agentData, planData, policyResponse] = await Promise.all([
        fetchAgents(),
        fetchProductPlans(),
        fetchPolicies({
          agentId: filters.agentId || undefined,
          status: filters.status || undefined,
          productType: filters.productType || undefined,
          page: policiesPage,
          pageSize: 20,
        }),
      ]);

      setAgents(agentData);
      setPlans(planData);
      setPolicies(policyResponse.items);
      setPoliciesMeta(policyResponse.meta);

      if (policyResponse.items.length === 0) {
        setSelectedPolicy(null);
        setPolicyEvents([]);
        setEventsMeta(DEFAULT_META);
      } else {
        const current = selectedPolicyId ? policyResponse.items.find((policy) => policy.id === selectedPolicyId) : null;
        const next = current ?? policyResponse.items[0];
        await loadEvents(next.id, 1, eventsTypeFilter);
        setEventsPage(1);
      }
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message);
      } else {
        setError("Unable to load policy data.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [eventsTypeFilter, filters.agentId, filters.productType, filters.status, loadEvents, policiesPage, selectedPolicyId]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const selectPolicy = useCallback(
    async (policyId: string) => {
      setError("");
      try {
        await loadEvents(policyId, 1, eventsTypeFilter);
        setEventsPage(1);
      } catch (requestError) {
        if (requestError instanceof ApiError) {
          setError(requestError.message);
        } else {
          setError("Unable to load policy details.");
        }
      }
    },
    [eventsTypeFilter, loadEvents],
  );

  const changeEventsPage = useCallback(
    async (page: number) => {
      if (!selectedPolicy) return;
      await loadEvents(selectedPolicy.id, page, eventsTypeFilter);
      setEventsPage(page);
    },
    [eventsTypeFilter, loadEvents, selectedPolicy],
  );

  const changeEventsTypeFilter = useCallback(
    async (eventType: string) => {
      setEventsTypeFilter(eventType);
      if (!selectedPolicy) return;
      await loadEvents(selectedPolicy.id, 1, eventType);
      setEventsPage(1);
    },
    [loadEvents, selectedPolicy],
  );

  const addEvent = useCallback(
    async (event: PolicyEventCreate) => {
      if (!selectedPolicy) return false;
      setIsSubmittingEvent(true);
      setError("");
      try {
        await createPolicyEvent(selectedPolicy.id, event);
        await loadEvents(selectedPolicy.id, 1, eventsTypeFilter);
        setEventsPage(1);
        return true;
      } catch (requestError) {
        if (requestError instanceof ApiError) {
          setError(requestError.message);
        } else {
          setError("Unable to create event.");
        }
        return false;
      } finally {
        setIsSubmittingEvent(false);
      }
    },
    [eventsTypeFilter, loadEvents, selectedPolicy],
  );

  return {
    agents,
    plans,
    plansById,
    agentsById,
    policies,
    policiesMeta,
    selectedPolicy,
    policyEvents,
    eventsMeta,
    eventsPage,
    eventsTypeFilter,
    error,
    isLoading,
    isSubmittingEvent,
    policiesPage,
    setPoliciesPage,
    selectPolicy,
    changeEventsPage,
    changeEventsTypeFilter,
    addEvent,
  };
}
