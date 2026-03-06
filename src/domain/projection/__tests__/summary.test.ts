import { describe, expect, it } from "vitest";

import type { ProjectionSnapshot } from "../types";
import { hasValueImpact, projectionHeadline } from "../summary";

const snapshot: ProjectionSnapshot = {
  policyId: "pol_ul_1001",
  asOfDate: "2025-12-31",
  values: {
    cashValue: 100,
    surrenderValue: 0,
    deathBenefit: 250000,
    loanBalance: 0,
    status: "inforce",
  },
  assumptions: {},
  appliedEvents: [
    {
      eventId: "evt_1",
      eventType: "PREMIUM_PAID",
      effectiveDate: "2025-01-01",
      delta: { cashValue: 100 },
      running: { cashValue: 100 },
    },
  ],
  warnings: [],
};

describe("projection summary helpers", () => {
  it("builds a stable headline", () => {
    expect(projectionHeadline(snapshot)).toBe("pol_ul_1001 @ 2025-12-31");
  });

  it("detects value impact from deltas", () => {
    expect(hasValueImpact(snapshot)).toBe(true);
  });
});
