import type { ProjectionSnapshot } from "../domain/projection/types";
import { getToken } from "./auth";
import { apiRequest } from "./api";

export type Agent = {
  id: string;
  name: string;
  agency: string;
  states: string[];
  status: "active" | "inactive";
};

export type ProductPlan = {
  id: string;
  code: string;
  productType: "TERM_LIFE" | "WHOLE_LIFE" | "UNIVERSAL_LIFE" | "INDEXED_UNIVERSAL_LIFE";
  params: Record<string, unknown>;
  effectiveFrom: string;
  version: string;
};

export type Policy = {
  id: string;
  policyNumber: string;
  agentId: string;
  owner: {
    fullName: string;
    dob: string;
  };
  insured: {
    fullName: string;
    dob: string;
    ratingClass: string;
  };
  planId: string;
  issueDate: string;
  faceAmount: number;
  status: "pending" | "inforce" | "lapsed" | "terminated";
};

export type PolicyEvent = {
  id: string;
  policyId: string;
  eventType:
    | "PREMIUM_PAID"
    | "MONTHLY_FEE_ASSESSED"
    | "INTEREST_CREDITED"
    | "LOAN_TAKEN"
    | "LOAN_REPAID"
    | "RIDER_CHANGED";
  effectiveDate: string;
  payload: Record<string, unknown>;
  source: "seed" | "api" | "import";
};

export type PolicyEventCreate = {
  eventType: PolicyEvent["eventType"];
  effectiveDate: string;
  payload: Record<string, unknown>;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PagedResponse<T> = {
  items: T[];
  meta: PaginationMeta;
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function fetchAgents(): Promise<Agent[]> {
  return apiRequest<Agent[]>("/api/agents", {
    headers: authHeaders(),
  });
}

export function fetchProductPlans(): Promise<ProductPlan[]> {
  return apiRequest<ProductPlan[]>("/api/product-plans", {
    headers: authHeaders(),
  });
}

export function fetchPolicies(filters?: {
  agentId?: string;
  status?: string;
  productType?: string;
  owner?: string;
  page?: number;
  pageSize?: number;
}): Promise<PagedResponse<Policy>> {
  const params = new URLSearchParams();
  if (filters?.agentId) {
    params.set("agent_id", filters.agentId);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (filters?.productType) {
    params.set("productType", filters.productType);
  }
  if (filters?.owner) {
    params.set("owner", filters.owner);
  }
  if (filters?.page) {
    params.set("page", String(filters.page));
  }
  if (filters?.pageSize) {
    params.set("pageSize", String(filters.pageSize));
  }
  const query = params.toString();
  const path = query ? `/api/policies?${query}` : "/api/policies";

  return apiRequest<PagedResponse<Policy>>(path, {
    headers: authHeaders(),
  });
}

export function fetchPolicy(policyId: string): Promise<Policy> {
  return apiRequest<Policy>(`/api/policies/${policyId}`, {
    headers: authHeaders(),
  });
}

export function fetchPolicyEvents(
  policyId: string,
  filters?: {
    eventType?: string;
    source?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<PagedResponse<PolicyEvent>> {
  const params = new URLSearchParams();
  if (filters?.eventType) {
    params.set("eventType", filters.eventType);
  }
  if (filters?.source) {
    params.set("source", filters.source);
  }
  if (filters?.fromDate) {
    params.set("fromDate", filters.fromDate);
  }
  if (filters?.toDate) {
    params.set("toDate", filters.toDate);
  }
  if (filters?.page) {
    params.set("page", String(filters.page));
  }
  if (filters?.pageSize) {
    params.set("pageSize", String(filters.pageSize));
  }
  const query = params.toString();
  const path = query ? `/api/policies/${policyId}/events?${query}` : `/api/policies/${policyId}/events`;
  return apiRequest<PagedResponse<PolicyEvent>>(path, {
    headers: authHeaders(),
  });
}

export function createPolicyEvent(policyId: string, event: PolicyEventCreate): Promise<PolicyEvent> {
  return apiRequest<PolicyEvent>(`/api/policies/${policyId}/events`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(event),
  });
}

export function projectPolicy(
  policyId: string,
  asOfDate: string,
  options?: {
    includeLoanEvents?: boolean;
    hypotheticalEvents?: PolicyEventCreate[];
  },
): Promise<ProjectionSnapshot> {
  return apiRequest<ProjectionSnapshot>(`/api/policies/${policyId}/projection`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      asOfDate,
      includeLoanEvents: options?.includeLoanEvents ?? false,
      hypotheticalEvents: options?.hypotheticalEvents ?? [],
    }),
  });
}
