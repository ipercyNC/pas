# Backend

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Notes

- Auth uses JWT bearer tokens from `POST /api/auth/login`.
- Protected endpoints require `Authorization: Bearer <token>`.
- Policies and policy events endpoints return paginated envelopes:
  - `{ "items": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`
