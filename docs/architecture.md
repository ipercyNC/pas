# PAS Prototype Architecture

## Overview

The prototype is split into a React frontend and a FastAPI backend, with local JSON files for persistence.

```text
+-----------------------+            HTTPS/JSON            +-------------------------+
| React + Vite Frontend |  <---------------------------->  | FastAPI + Pydantic API  |
| - Login               |                                  | - Auth (JWT bearer)     |
| - Policies            |                                  | - Policies/Events APIs  |
| - Time Machine        |                                  | - Projection endpoint   |
+-----------+-----------+                                  +-----------+-------------+
            |                                                          |
            |                                                          |
            |                                              +-----------v-------------+
            |                                              | Projection Engine       |
            |                                              | - Event replay          |
            |                                              | - Product strategies    |
            |                                              | - Explainability trail  |
            |                                              +-----------+-------------+
            |                                                          |
            |                                              +-----------v-------------+
            |                                              | JsonRepository          |
            |                                              | backend/localdb/*.json |
            |                                              +-------------------------+
```

## Request Flow

1. User logs in at `/api/auth/login`.
2. Backend verifies salted password hash and issues JWT access token.
3. Frontend sends `Authorization: Bearer <token>` for protected routes.
4. Policies/events endpoints return paginated responses.
5. Time Machine calls projection endpoint with:
   - `asOfDate`
   - `includeLoanEvents`
   - optional `hypotheticalEvents`
6. Projection engine replays event timeline and returns:
   - values
   - assumptions
   - applied event deltas/running totals
   - warnings

## Core Design Choices

- Event-sourced replay instead of static formulas.
- Strategy-per-product for rule isolation (`TERM_LIFE`, `WHOLE_LIFE`, `UNIVERSAL_LIFE`, `INDEXED_UNIVERSAL_LIFE`).
- JSON persistence for zero-friction local demo setup.
- Deterministic replay ordering by date/tiebreak key for stable outputs.

## Known Prototype Constraints

- No relational DB constraints/transactions.
- No background projection workers.
- Minimal RBAC model.
- Simplified insurance math (not actuarial-grade valuation).
