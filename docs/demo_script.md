# PAS Prototype Demo Script (8-10 minutes)

## 1. Login (1 minute)

- Open app and sign in with demo credentials.
- Call out JWT-based auth and protected API routes.

## 2. Policies + Ledger (3 minutes)

- Navigate to Policies.
- Filter by product/status/agent.
- Select a policy and show event ledger with pagination/filtering.
- Add an event and show immediate ledger refresh.

## 3. Time Machine Projection (3 minutes)

- Navigate to Time Machine.
- Pick product type + policy.
- Confirm selected product and face amount banner.
- Set target date and run projection.
- Show trend chart + loading overlay behavior during recalculation.
- Walk through projected values and assumptions.

## 4. Explainability (1-2 minutes)

- Expand applied events rows.
- Highlight delta and running totals for explainable outcomes.
- Add a theoretical event and rerun to show value change.

## 5. Production Roadmap Close (1 minute)

- Call out this as prototype architecture.
- Next steps:
  - PostgreSQL + migrations
  - OIDC/RBAC + audit logs
  - observability + CI/CD + infra hardening
  - projection governance and regression packs
