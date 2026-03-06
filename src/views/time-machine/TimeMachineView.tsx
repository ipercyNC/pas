import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useProjection } from "../../hooks/useProjection";
import { PolicyEventCreate } from "../../lib/pasApi";

const PRODUCT_EVENT_TYPES: Record<string, PolicyEventCreate["eventType"][]> = {
  TERM_LIFE: ["RIDER_CHANGED"],
  WHOLE_LIFE: ["LOAN_TAKEN", "LOAN_REPAID", "RIDER_CHANGED"],
  UNIVERSAL_LIFE: ["LOAN_TAKEN", "LOAN_REPAID", "RIDER_CHANGED"],
  INDEXED_UNIVERSAL_LIFE: ["LOAN_TAKEN", "LOAN_REPAID", "RIDER_CHANGED"],
};

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatAxisDate(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`;
}

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
  const normalized = value.toLowerCase();
  if (normalized === "inforce") return "In Force";
  return toTitleFromToken(value);
}

function formatMetricValue(key: string, value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    const percentageHint = /(rate|participation|percent|ratio|yield|return)/i.test(key);
    if (percentageHint) {
      const pct = Math.abs(value) <= 2 ? value * 100 : value;
      return `${pct.toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
    }
    const moneyHint = /(value|premium|benefit|balance|charge|fee|amount)/i.test(key);
    if (moneyHint) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(value);
}

function TrendChart({
  points,
  asOfDate,
  onTargetDateChange,
  minDate,
  isLoading,
}: {
  points: Array<{
    date: string;
    cashValue: number;
    surrenderValue: number;
    deathBenefit: number;
    loanBalance: number;
  }>;
  asOfDate: string;
  onTargetDateChange: (value: string) => void;
  minDate: string;
  isLoading: boolean;
}) {
  const toUsd = (value: number) => `$${Math.round(value).toLocaleString()}`;

  return (
    <div className="trend-card">
      <div className="trend-header">
        <div>
          <h2>Projected Value Trend</h2>
          <p className="hint">Drag the slider under the chart to drill into a smaller date range.</p>
        </div>
        <label className="trend-date-control">
          Target Date
          <input type="date" min={minDate} value={asOfDate} onChange={(event) => onTargetDateChange(event.target.value)} />
        </label>
      </div>
      <div className="trend-wrap">
        {points.length < 2 ? (
          <p className="hint">Not enough projection points for chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={points} margin={{ top: 12, right: 20, left: 10, bottom: 12 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={18} />
              <YAxis tickFormatter={toUsd} width={92} />
              <Tooltip formatter={(value: number, name: string) => [toUsd(value), name]} labelFormatter={(value: string) => `Date: ${value}`} />
              <Line type="monotone" dataKey="cashValue" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Cash Value" />
              <Line type="monotone" dataKey="surrenderValue" stroke="#0f766e" strokeWidth={2} dot={false} name="Surrender Value" />
              <Line type="monotone" dataKey="deathBenefit" stroke="#7c3aed" strokeWidth={2} dot={false} name="Death Benefit" />
              <Brush dataKey="date" height={26} stroke="#2563eb" travellerWidth={10} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {isLoading ? (
          <div className="trend-loading-overlay">
            <div className="trend-spinner" />
            <span>Updating projection...</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TimeMachineView() {
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [hypEventType, setHypEventType] = useState<PolicyEventCreate["eventType"]>("LOAN_TAKEN");
  const [hypEventDate, setHypEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [hypAmount, setHypAmount] = useState("100");
  const [hypRiderCode, setHypRiderCode] = useState("ADB");
  const [hypRiderAction, setHypRiderAction] = useState("add");
  const [hypMonthlyCharge, setHypMonthlyCharge] = useState("0");

  const {
    todayIso,
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
  } = useProjection();

  const selectedPolicy = useMemo(
    () => filteredPolicies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [filteredPolicies, selectedPolicyId],
  );
  const selectedPolicyProduct = selectedPolicy ? planById.get(selectedPolicy.planId)?.productType ?? "Unknown" : "Unknown";
  const allowedHypEventTypes = useMemo(
    () => PRODUCT_EVENT_TYPES[selectedPolicyProduct] ?? PRODUCT_EVENT_TYPES.UNIVERSAL_LIFE,
    [selectedPolicyProduct],
  );

  useEffect(() => {
    if (!allowedHypEventTypes.includes(hypEventType)) {
      setHypEventType(allowedHypEventTypes[0]);
    }
  }, [allowedHypEventTypes, hypEventType]);

  const visibleAppliedEvents = projection?.appliedEvents ?? [];

  const handleProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runProjection();
    setExpandedEventIds(new Set());
  };

  const buildHypPayload = (): Record<string, unknown> => {
    if (hypEventType === "RIDER_CHANGED") {
      return {
        riderCode: hypRiderCode,
        action: hypRiderAction,
        monthlyCharge: Number(hypMonthlyCharge),
      };
    }
    if (hypEventType === "LOAN_TAKEN") return { amount: Number(hypAmount), loanType: "theoretical" };
    if (hypEventType === "LOAN_REPAID") return { amount: Number(hypAmount) };
    if (hypEventType === "MONTHLY_FEE_ASSESSED") return { amount: Number(hypAmount), reason: "theoretical" };
    return { amount: Number(hypAmount), mode: "theoretical" };
  };

  const addHypotheticalEvent = () => {
    const event: PolicyEventCreate = {
      eventType: hypEventType,
      effectiveDate: clampTargetDate(hypEventDate, todayIso),
      payload: buildHypPayload(),
    };
    setHypotheticalEvents((current) => [...current, event]);
    setError("");
  };

  const toggleEventRow = (eventId: string) => {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  return (
    <div>
      <h1>Time Machine</h1>
      {error ? <p className="error">{error}</p> : null}
      {isLoading ? <p>Loading projection inputs...</p> : null}

      <form className="projection-controls" onSubmit={handleProject}>
        <label>
          Product Type
          <select value={productTypeFilter} onChange={(event) => setProductTypeFilter(event.target.value)}>
            {productTypeOptions.map((type) => (
              <option key={type} value={type}>
                {type === "ALL" ? "All Products" : toTitleFromToken(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Policy
          <select
            value={selectedPolicyId}
            onChange={(event) => {
              setSelectedPolicyId(event.target.value);
            }}
            required
          >
            {filteredPolicies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.policyNumber} - {policy.owner.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Include Existing Loan Events
          <select value={includeLoanEvents ? "YES" : "NO"} onChange={(event) => setIncludeLoanEvents(event.target.value === "YES")}>
            <option value="NO">No (Default)</option>
            <option value="YES">Yes</option>
          </select>
        </label>
        <button type="submit" disabled={!selectedPolicyId || isProjecting}>
          {isProjecting ? "Projecting..." : "Project"}
        </button>
      </form>

      <section className="hyp-panel">
        <h2>Theoretical Events</h2>
        <div className="hyp-grid">
          <label>
            Event Type
            <select value={hypEventType} onChange={(event) => setHypEventType(event.target.value as PolicyEventCreate["eventType"])}>
              {allowedHypEventTypes.map((type) => (
                <option key={type} value={type}>
                  {toTitleFromToken(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" min={todayIso} value={hypEventDate} onChange={(event) => setHypEventDate(event.target.value)} />
          </label>
          {(hypEventType === "PREMIUM_PAID" || hypEventType === "MONTHLY_FEE_ASSESSED" || hypEventType === "LOAN_TAKEN" || hypEventType === "LOAN_REPAID") ? (
            <label>
              Amount
              <input type="number" step="0.01" value={hypAmount} onChange={(event) => setHypAmount(event.target.value)} />
            </label>
          ) : null}
          {hypEventType === "RIDER_CHANGED" ? (
            <>
              <label>
                Rider Code
                <input value={hypRiderCode} onChange={(event) => setHypRiderCode(event.target.value)} />
              </label>
              <label>
                Action
                <select value={hypRiderAction} onChange={(event) => setHypRiderAction(event.target.value)}>
                  <option value="add">Add</option>
                  <option value="remove">Remove</option>
                  <option value="update">Update</option>
                </select>
              </label>
              <label>
                Monthly Charge
                <input type="number" step="0.01" value={hypMonthlyCharge} onChange={(event) => setHypMonthlyCharge(event.target.value)} />
              </label>
            </>
          ) : null}
          <button type="button" onClick={addHypotheticalEvent}>
            Add Theoretical Event
          </button>
        </div>

        {hypotheticalEvents.length > 0 ? (
          <div className="hyp-list">
            {hypotheticalEvents.map((event, index) => (
              <article key={`${event.eventType}-${event.effectiveDate}-${index}`} className="ledger-item">
                <p>
                  <strong>{toTitleFromToken(event.eventType)}</strong> on {event.effectiveDate}
                </p>
                <div className="kv-grid">
                  {Object.entries(event.payload).map(([key, value]) => (
                    <div key={`${event.eventType}-${index}-${key}`} className="kv-item">
                      <span>{toTitleFromToken(key)}</span>
                      <strong>{formatMetricValue(key, value)}</strong>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="row-toggle"
                  onClick={() => setHypotheticalEvents((current) => current.filter((_, idx) => idx !== index))}
                >
                  Remove
                </button>
              </article>
            ))}
            <button type="button" className="row-toggle" onClick={() => setHypotheticalEvents([])}>
              Clear All
            </button>
          </div>
        ) : (
          <p className="hint">No theoretical events added.</p>
        )}
      </section>

      {selectedPolicy ? (
        <section className="selection-banner">
          <div>
            <p className="selection-label">Selected Policy</p>
            <h2>{selectedPolicy.policyNumber}</h2>
            <p className="hint">{selectedPolicy.owner.fullName}</p>
          </div>
          <div>
            <p className="selection-label">Product</p>
            <p className="product-pill">{toTitleFromToken(selectedPolicyProduct)}</p>
          </div>
          <div>
            <p className="selection-label">Face Amount</p>
            <p className="hint">${selectedPolicy.faceAmount.toLocaleString()}</p>
          </div>
        </section>
      ) : null}

      <TrendChart
        points={trendPoints}
        asOfDate={asOfDate}
        minDate={todayIso}
        isLoading={isLoadingTrend}
        onTargetDateChange={(value) => setAsOfDate(clampTargetDate(value, todayIso))}
      />

      {projection ? (
        <section className="projection-layout">
          <div>
            <h2>Projected Values</h2>
            <div className="kpi-grid">
              <article className="kpi-card">
                <p>Cash Value</p>
                <strong>${projection.values.cashValue.toLocaleString()}</strong>
              </article>
              <article className="kpi-card">
                <p>Surrender Value</p>
                <strong>${projection.values.surrenderValue.toLocaleString()}</strong>
              </article>
              <article className="kpi-card">
                <p>Death Benefit</p>
                <strong>${projection.values.deathBenefit.toLocaleString()}</strong>
              </article>
              <article className="kpi-card">
                <p>Loan Balance</p>
                <strong>${projection.values.loanBalance.toLocaleString()}</strong>
              </article>
              <article className="kpi-card">
                <p>Status</p>
                <strong>{formatStatus(projection.values.status)}</strong>
              </article>
            </div>

            <h2>Applied Events</h2>
            {visibleAppliedEvents.length === 0 ? <p>No events applied up to this date.</p> : null}
            {visibleAppliedEvents.length > 0 ? (
              <div className="events-table-wrap">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Date</th>
                      <th>Impact Fields</th>
                      <th>Cash Value</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAppliedEvents.map((entry) => {
                      const isExpanded = expandedEventIds.has(entry.eventId);
                      return (
                        <Fragment key={entry.eventId}>
                          <tr>
                            <td>{toTitleFromToken(entry.eventType)}</td>
                            <td>{entry.effectiveDate}</td>
                            <td>{Object.keys(entry.delta).length}</td>
                            <td>{formatMetricValue("cashValue", entry.running.cashValue)}</td>
                            <td>
                              <button type="button" className="row-toggle" onClick={() => toggleEventRow(entry.eventId)}>
                                {isExpanded ? "Hide" : "Show"}
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="expanded-row">
                              <td colSpan={5}>
                                <div className="metric-section">
                                  <p className="metric-title">Impact</p>
                                  <div className="kv-grid">
                                    {Object.entries(entry.delta).map(([key, value]) => (
                                      <div className="kv-item" key={`${entry.eventId}-delta-${key}`}>
                                        <span>{toTitleFromToken(key)}</span>
                                        <strong>{formatMetricValue(key, value)}</strong>
                                      </div>
                                    ))}
                                    {Object.keys(entry.delta).length === 0 ? <p className="meta">No direct value impact.</p> : null}
                                  </div>
                                </div>
                                <div className="metric-section">
                                  <p className="metric-title">Running Totals</p>
                                  <div className="kv-grid">
                                    {Object.entries(entry.running).map(([key, value]) => (
                                      <div className="kv-item" key={`${entry.eventId}-running-${key}`}>
                                        <span>{toTitleFromToken(key)}</span>
                                        <strong>{formatMetricValue(key, value)}</strong>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          <aside className="policy-detail">
            <h2>Assumptions</h2>
            <div className="ledger">
              {Object.entries(projection.assumptions).map(([key, value]) => (
                <article key={key} className="ledger-item">
                  <p>
                    <strong>{toTitleFromToken(key)}</strong>
                  </p>
                  <p className="meta assumption-value">{formatMetricValue(key, value)}</p>
                </article>
              ))}
            </div>
            <h2>Warnings</h2>
            <ul className="warnings">
              {projection.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {projection.warnings.length === 0 ? <li>No warnings.</li> : null}
            </ul>
          </aside>
        </section>
      ) : (
        <p className="hint">Run a projection to view values and event explainability.</p>
      )}
    </div>
  );
}
