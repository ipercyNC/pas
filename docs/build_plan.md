# PAS Prototype Build Plan

Guide for building the PAS prototype with FastAPI + Pydantic backend, React + TypeScript frontend, and local JSON persistence.

## Status Board

- [x] Phase 0 - Project Scaffolding and Contracts
- [x] Phase 1 - Auth + Security Baseline
- [x] Phase 2 - Read APIs + Policy Browser UI
- [x] Phase 3 - Policy Event Ingestion + Ledger UI
- [x] Phase 4 - Projection Engine + Time-Machine API
- [x] Phase 5 - Hardening, Tests, Verify Command
- [x] Phase 6 - Contract Stabilization + UI/Data Refactor

## Stack and Architecture

- Backend: FastAPI + Pydantic models + local JSON repository (`backend/localdb/*.json`)
- Frontend: React + TypeScript + Vite
- Persistence: local JSON files with safe-write pattern (temp file + atomic rename)
- Auth: JWT bearer token after login
- Core capability: policy time-machine projection replayed from events

## Pydantic Decision

- [x] Use Pydantic for request/response and domain models.
- Reason: strict validation, stable contracts, and clean FastAPI integration.

## Phase 0 - Project Scaffolding and Contracts (Completed)

Goal: initialize backend/frontend folders and lock stable contracts.

Tasks:
- [x] Create backend app skeleton:
  - [x] `backend/app/main.py`
  - [x] `backend/app/models.py`
  - [x] `backend/app/repository.py`
  - [x] `backend/app/auth.py`
  - [x] `backend/app/projection_engine.py`
- [x] Create frontend app skeleton:
  - [x] `src/views/login`
  - [x] `src/views/policies`
  - [x] `src/views/time-machine`
  - [x] `src/domain/projection`
- [x] Keep and reference contract docs:
  - [x] `docs/contracts/fixture-schema.json`
  - [x] `docs/contracts/projection-examples.json`
- [x] Confirm localdb fixture files exist and parse.

Exit criteria:
- [x] Backend scaffold exists and exposes `/health`.
- [x] Frontend scaffold exists with view routing shells.
- [x] Fixture and contract JSON files are valid.

## Phase 1 - Auth + Security Baseline (Completed)

Goal: login/logout flow and protected APIs.

Tasks:
- [x] Implement `POST /api/auth/login`.
- [x] Validate user credentials from `backend/localdb/users.json`.
- [x] Return signed bearer token.
- [x] Add auth dependency for protected routes.
- [x] Add CORS allowlist and security headers middleware.
- [x] Add normalized API error format.
- [x] Add frontend login API integration.
- [x] Add protected-route flow and logout.

Exit criteria:
- [x] Valid login returns token and unlocks protected pages.
- [x] Invalid login returns normalized errors.
- [x] Protected endpoints reject missing/invalid token.

## Phase 2 - Read APIs + Policy Browser UI (Completed)

Goal: read-only PAS browsing (agents/plans/policies).

Tasks:
- [x] Implement `GET /health`.
- [x] Implement `GET /api/agents`.
- [x] Implement `GET /api/product-plans`.
- [x] Implement `GET /api/policies`.
- [x] Implement `GET /api/policies/{policy_id}`.
- [x] Add repository support for filters (product, status, agent).
- [x] Build policy list with filters.
- [x] Build policy detail metadata view.

Exit criteria:
- [x] User can browse read models after login.
- [x] Filtering behavior is deterministic.

## Phase 3 - Policy Event Ingestion + Ledger UI (Completed)

Goal: event read/write and explainable timeline foundation.

Tasks:
- [x] Implement `GET /api/policies/{policy_id}/events`.
- [x] Implement `POST /api/policies/{policy_id}/events`.
- [x] Validate event payload per event type with Pydantic.
- [x] Enforce deterministic order: `effectiveDate`, then `id`.
- [x] Add write-rate limiting for mutation routes.
- [x] Persist events with safe-write JSON pattern.
- [x] Build event ledger UI.
- [x] Build add-event form for all MVP event types.

Exit criteria:
- [x] Event writes persist and appear immediately.
- [x] Invalid payloads return clear validation errors.

## Phase 4 - Projection Engine + Time-Machine API (Completed)

Goal: deterministic snapshot for any date with explainability.

Tasks:
- [x] Implement product strategies:
  - [x] `TermStrategy`
  - [x] `WholeLifeStrategy`
  - [x] `UniversalLifeStrategy`
- [x] Implement replay ledger state:
  - [x] premium paid
  - [x] account/cash value
  - [x] loans outstanding
  - [x] charges assessed
  - [x] death benefit basis
- [x] Implement `POST /api/policies/{policy_id}/projection`.
- [x] Include values, assumptions, applied events, warnings in response.
- [x] Build Time Machine UI (date picker + project action + value cards + timeline).

Exit criteria:
- [x] Projection works for TERM, WHOLE, UL fixtures.
- [x] Same policy/date yields deterministic output.
- [x] Add event -> rerun projection -> values update.

## Phase 5 - Hardening, Tests, Verify Command (Completed)

Goal: reliable clean setup and demo run.

Tasks:
- [x] Add backend unit tests for replay ordering and strategy math.
- [x] Add backend integration tests for auth/APIs/projection.
- [x] Add frontend domain tests and core flow tests.
- [x] Add lint/test/build scripts.
- [x] Add `npm run verify` command.
- [x] Add setup and demo docs.

Exit criteria:
- [x] `npm run verify` passes.
- [x] Demo flow works end-to-end with local files only.

## Phase 6 - Contract Stabilization + UI/Data Refactor (Completed)

Goal: tighten API contracts, improve UX polish, and reduce frontend view complexity.

Tasks:
- [x] Stabilize projection behavior with golden tests.
- [x] Add API contract tests for core auth/read/projection endpoints.
- [x] Switch auth token implementation to standards-based JWT.
- [x] Add server-side pagination and filtering envelopes for policies/events APIs.
- [x] Refactor frontend data state into hooks:
  - [x] `usePolicies`
  - [x] `useProjection`
- [x] Replace remaining raw JSON payload rendering with formatted key/value components.
- [x] Improve loading/empty/error states and copy polish in Policies and Time Machine views.
- [x] Add architecture and demo documentation:
  - [x] `docs/architecture.md`
  - [x] `docs/demo_script.md`

Exit criteria:
- [x] Frontend uses paged API contracts.
- [x] JWT auth flow remains compatible with protected routes.
- [x] `npm run verify` passes with updated contracts and tests.

## API Checklist (MVP)

- [x] `GET /health`
- [x] `POST /api/auth/login`
- [x] `GET /api/agents`
- [x] `GET /api/product-plans`
- [x] `GET /api/policies`
- [x] `GET /api/policies/{policy_id}`
- [x] `GET /api/policies/{policy_id}/events`
- [x] `POST /api/policies/{policy_id}/events`
- [x] `POST /api/policies/{policy_id}/projection`
- [ ] `GET /api/projections/history?policy_id=...` (stretch)

## MVP Acceptance Checklist

- [x] User can log in and access protected PAS pages.
- [x] At least 20 fixture policies across term/whole/UL.
- [x] Projection is deterministic for same policy/date.
- [x] Projection includes values + explainability timeline.
- [x] Event change causes visible projection delta.
- [x] App runs from clean setup with local files only.
- [x] `npm run verify` passes.
