export type ProjectionValues = {
  cashValue: number;
  surrenderValue: number;
  deathBenefit: number;
  loanBalance: number;
  status: string;
};

export type ProjectionAppliedEvent = {
  eventId: string;
  eventType: string;
  effectiveDate: string;
  delta: Record<string, number>;
  running: Record<string, number>;
};

export type ProjectionSnapshot = {
  policyId: string;
  asOfDate: string;
  values: ProjectionValues;
  assumptions: Record<string, unknown>;
  appliedEvents: ProjectionAppliedEvent[];
  warnings: string[];
};
