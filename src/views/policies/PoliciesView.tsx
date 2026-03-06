import { FormEvent, useMemo, useState } from "react";

import { usePolicies } from "../../hooks/usePolicies";
import { PolicyEvent, PolicyEventCreate } from "../../lib/pasApi";

const STATUS_OPTIONS = ["", "pending", "inforce", "lapsed", "terminated"];
const PRODUCT_OPTIONS = ["", "TERM_LIFE", "WHOLE_LIFE", "UNIVERSAL_LIFE", "INDEXED_UNIVERSAL_LIFE"];
const EVENT_TYPES: PolicyEvent["eventType"][] = [
  "PREMIUM_PAID",
  "MONTHLY_FEE_ASSESSED",
  "INTEREST_CREDITED",
  "LOAN_TAKEN",
  "LOAN_REPAID",
  "RIDER_CHANGED",
];

function toTitleFromToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatStatus(value: string): string {
  if (value.toLowerCase() === "inforce") {
    return "In Force";
  }
  return toTitleFromToken(value);
}

function formatFieldValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    const percentageHint = /(rate|participation|percent|ratio|yield|return)/i.test(key);
    if (percentageHint) {
      const pct = Math.abs(value) <= 2 ? value * 100 : value;
      return `${pct.toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
    }
    const moneyHint = /(amount|premium|fee|charge|balance|value|benefit)/i.test(key);
    if (moneyHint) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

export function PoliciesView() {
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");

  const [eventType, setEventType] = useState<PolicyEvent["eventType"]>("PREMIUM_PAID");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("100");
  const [mode, setMode] = useState("single");
  const [reason, setReason] = useState("administrative");
  const [rateAnnual, setRateAnnual] = useState("0.045");
  const [creditedAmount, setCreditedAmount] = useState("0");
  const [loanType, setLoanType] = useState("standard");
  const [riderCode, setRiderCode] = useState("ADB");
  const [riderAction, setRiderAction] = useState("add");
  const [monthlyCharge, setMonthlyCharge] = useState("0");
  const [success, setSuccess] = useState("");

  const {
    agents,
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
  } = usePolicies({
    agentId: agentFilter,
    status: statusFilter,
    productType: productFilter,
  });

  const buildPayload = (): PolicyEventCreate["payload"] => {
    switch (eventType) {
      case "PREMIUM_PAID":
        return { amount: Number(amount), mode };
      case "MONTHLY_FEE_ASSESSED":
        return { amount: Number(amount), reason };
      case "INTEREST_CREDITED":
        return { rateAnnual: Number(rateAnnual), creditedAmount: Number(creditedAmount) };
      case "LOAN_TAKEN":
        return { amount: Number(amount), loanType };
      case "LOAN_REPAID":
        return { amount: Number(amount) };
      case "RIDER_CHANGED":
        return { riderCode, action: riderAction, monthlyCharge: Number(monthlyCharge) };
      default:
        return {};
    }
  };

  const selectedPolicyProduct = useMemo(
    () => (selectedPolicy ? toTitleFromToken(plansById.get(selectedPolicy.planId)?.productType ?? "Unknown") : "Unknown"),
    [plansById, selectedPolicy],
  );

  const handleCreateEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPolicy) {
      return;
    }
    setSuccess("");
    const ok = await addEvent({
      eventType,
      effectiveDate,
      payload: buildPayload(),
    });
    if (ok) {
      setSuccess("Event added and ledger refreshed.");
    }
  };

  return (
    <div>
      <h1>Policies</h1>
      <section className="filters">
        <label>
          Product
          <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
            {PRODUCT_OPTIONS.map((option) => (
              <option key={option || "all"} value={option}>
                {option ? toTitleFromToken(option) : "All"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option || "all"} value={option}>
                {option ? formatStatus(option) : "All"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="">All</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}
      {isLoading ? <p>Loading policies and ledger...</p> : null}

      <section className="policy-layout">
        <div className="policy-list">
          {policies.map((policy) => {
            const plan = plansById.get(policy.planId);
            const agent = agentsById.get(policy.agentId);
            return (
              <button
                type="button"
                key={policy.id}
                className={`policy-row policy-row-rich ${selectedPolicy?.id === policy.id ? "selected" : ""}`}
                onClick={() => void selectPolicy(policy.id)}
              >
                <strong>{policy.policyNumber}</strong>
                <span>{policy.owner.fullName}</span>
                <span>{toTitleFromToken(plan?.productType ?? "unknown")}</span>
                <span>{agent?.name ?? "Unknown Agent"}</span>
                <span>{formatStatus(policy.status)}</span>
              </button>
            );
          })}
          {policies.length === 0 && !isLoading ? <p>No policies match the current filters.</p> : null}
          <div className="pager">
            <button type="button" className="row-toggle" disabled={policiesMeta.page <= 1} onClick={() => setPoliciesPage(policiesPage - 1)}>
              Previous
            </button>
            <span className="meta">
              Page {policiesMeta.page} of {policiesMeta.totalPages} ({policiesMeta.total} total)
            </span>
            <button
              type="button"
              className="row-toggle"
              disabled={policiesMeta.page >= policiesMeta.totalPages}
              onClick={() => setPoliciesPage(policiesPage + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <aside className="policy-detail">
          {!selectedPolicy ? (
            <p>Select a policy to see details.</p>
          ) : (
            <div>
              <section className="selection-banner">
                <div>
                  <p className="selection-label">Policy</p>
                  <h2>{selectedPolicy.policyNumber}</h2>
                  <p className="hint">{selectedPolicy.owner.fullName}</p>
                </div>
                <div>
                  <p className="selection-label">Product</p>
                  <p className="product-pill">{selectedPolicyProduct}</p>
                </div>
                <div>
                  <p className="selection-label">Status</p>
                  <p className="hint">{formatStatus(selectedPolicy.status)}</p>
                </div>
              </section>

              <div className="kv-grid policy-meta-grid">
                <div className="kv-item">
                  <span>Insured</span>
                  <strong>{selectedPolicy.insured.fullName}</strong>
                </div>
                <div className="kv-item">
                  <span>Issue Date</span>
                  <strong>{selectedPolicy.issueDate}</strong>
                </div>
                <div className="kv-item">
                  <span>Face Amount</span>
                  <strong>${selectedPolicy.faceAmount.toLocaleString()}</strong>
                </div>
                <div className="kv-item">
                  <span>Agent</span>
                  <strong>{agentsById.get(selectedPolicy.agentId)?.name ?? "Unknown"}</strong>
                </div>
              </div>

              <div className="events-toolbar">
                <h3>Event Ledger</h3>
                <label>
                  Event Type
                  <select value={eventsTypeFilter} onChange={(event) => void changeEventsTypeFilter(event.target.value)}>
                    <option value="">All</option>
                    {EVENT_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {toTitleFromToken(option)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="events-table-wrap">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Date</th>
                      <th>Source</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policyEvents.map((policyEvent) => (
                      <tr key={policyEvent.id}>
                        <td>{toTitleFromToken(policyEvent.eventType)}</td>
                        <td>{policyEvent.effectiveDate}</td>
                        <td>{toTitleFromToken(policyEvent.source)}</td>
                        <td>
                          <div className="kv-grid">
                            {Object.entries(policyEvent.payload).map(([key, value]) => (
                              <div key={`${policyEvent.id}-${key}`} className="kv-item">
                                <span>{toTitleFromToken(key)}</span>
                                <strong>{formatFieldValue(key, value)}</strong>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {policyEvents.length === 0 ? (
                      <tr>
                        <td colSpan={4}>No events found for current filter/page.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button type="button" className="row-toggle" disabled={eventsMeta.page <= 1} onClick={() => void changeEventsPage(eventsPage - 1)}>
                  Previous
                </button>
                <span className="meta">
                  Page {eventsMeta.page} of {eventsMeta.totalPages} ({eventsMeta.total} total)
                </span>
                <button
                  type="button"
                  className="row-toggle"
                  disabled={eventsMeta.page >= eventsMeta.totalPages}
                  onClick={() => void changeEventsPage(eventsPage + 1)}
                >
                  Next
                </button>
              </div>

              <h3>Add Event</h3>
              <form className="event-form" onSubmit={handleCreateEvent}>
                <label>
                  Event Type
                  <select value={eventType} onChange={(event) => setEventType(event.target.value as PolicyEvent["eventType"])}>
                    {EVENT_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {toTitleFromToken(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Effective Date
                  <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required />
                </label>
                {eventType === "PREMIUM_PAID" || eventType === "MONTHLY_FEE_ASSESSED" || eventType === "LOAN_TAKEN" || eventType === "LOAN_REPAID" ? (
                  <label>
                    Amount
                    <input type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                  </label>
                ) : null}
                {eventType === "PREMIUM_PAID" ? (
                  <label>
                    Mode
                    <input value={mode} onChange={(event) => setMode(event.target.value)} />
                  </label>
                ) : null}
                {eventType === "MONTHLY_FEE_ASSESSED" ? (
                  <label>
                    Reason
                    <input value={reason} onChange={(event) => setReason(event.target.value)} />
                  </label>
                ) : null}
                {eventType === "INTEREST_CREDITED" ? (
                  <>
                    <label>
                      Annual Rate
                      <input type="number" step="0.0001" value={rateAnnual} onChange={(event) => setRateAnnual(event.target.value)} required />
                    </label>
                    <label>
                      Credited Amount
                      <input type="number" step="0.01" value={creditedAmount} onChange={(event) => setCreditedAmount(event.target.value)} required />
                    </label>
                  </>
                ) : null}
                {eventType === "LOAN_TAKEN" ? (
                  <label>
                    Loan Type
                    <input value={loanType} onChange={(event) => setLoanType(event.target.value)} />
                  </label>
                ) : null}
                {eventType === "RIDER_CHANGED" ? (
                  <>
                    <label>
                      Rider Code
                      <input value={riderCode} onChange={(event) => setRiderCode(event.target.value)} required />
                    </label>
                    <label>
                      Action
                      <select value={riderAction} onChange={(event) => setRiderAction(event.target.value)}>
                        <option value="add">Add</option>
                        <option value="remove">Remove</option>
                        <option value="update">Update</option>
                      </select>
                    </label>
                    <label>
                      Monthly Charge
                      <input type="number" step="0.01" value={monthlyCharge} onChange={(event) => setMonthlyCharge(event.target.value)} />
                    </label>
                  </>
                ) : null}
                <button type="submit" disabled={isSubmittingEvent}>
                  {isSubmittingEvent ? "Adding..." : "Add Event"}
                </button>
              </form>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
