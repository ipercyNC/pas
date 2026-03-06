from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login_token() -> str:
    response = client.post(
        "/api/auth/login",
        json={"email": "demo.admin@pas.local", "password": "ChangeMe123!"},
    )
    assert response.status_code == 200
    return response.json()["accessToken"]


def test_login_rejects_invalid_credentials() -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": "demo.admin@pas.local", "password": "bad-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Invalid credentials"


def test_session_requires_bearer_token() -> None:
    response = client.get("/api/auth/session")
    assert response.status_code == 401


def test_projection_endpoint_returns_values() -> None:
    token = _login_token()
    response = client.post(
        "/api/policies/pol_ul_1001/projection",
        headers={"Authorization": f"Bearer {token}"},
        json={"asOfDate": "2025-12-31"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["policyId"] == "pol_ul_1001"
    assert "values" in payload
    assert "appliedEvents" in payload


def test_login_returns_jwt_access_token_contract() -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": "demo.admin@pas.local", "password": "ChangeMe123!"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tokenType"] == "Bearer"
    assert isinstance(payload["expiresInSeconds"], int)
    assert payload["accessToken"].count(".") == 2
    assert {"id", "email", "displayName", "roles"} <= set(payload["user"].keys())


def test_policies_endpoint_supports_filter_and_pagination_contract() -> None:
    token = _login_token()
    response = client.get(
        "/api/policies?productType=UNIVERSAL_LIFE&page=1&pageSize=5",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {"items", "meta"}
    assert {"page", "pageSize", "total", "totalPages"} <= set(payload["meta"].keys())
    assert payload["meta"]["pageSize"] == 5
    assert len(payload["items"]) <= 5
    assert all("planId" in item for item in payload["items"])


def test_policy_events_endpoint_supports_filter_and_pagination_contract() -> None:
    token = _login_token()
    response = client.get(
        "/api/policies/pol_ul_1001/events?eventType=PREMIUM_PAID&page=1&pageSize=10",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {"items", "meta"}
    assert {"page", "pageSize", "total", "totalPages"} <= set(payload["meta"].keys())
    assert all(item["eventType"] == "PREMIUM_PAID" for item in payload["items"])
