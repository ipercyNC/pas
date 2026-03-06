from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.models import User, UserPublic
from app.repository import JsonRepository

TOKEN_TTL_SECONDS = 60 * 60 * 8
bearer_scheme = HTTPBearer(auto_error=False)
_auth_service: "AuthService | None" = None


class AuthService:
    def __init__(self, repository: JsonRepository) -> None:
        self.repository = repository
        self.secret = os.getenv("PAS_AUTH_SECRET", "pas-dev-secret-change-in-prod")
        self.issuer = os.getenv("PAS_AUTH_ISSUER", "pas-prototype")
        self.audience = os.getenv("PAS_AUTH_AUDIENCE", "pas-web")
        self.algorithm = "HS256"

    def authenticate(self, email: str, password: str) -> User | None:
        normalized_email = email.strip().lower()
        for user in self.repository.read_list("users.json", User):
            if user.email.lower() != normalized_email:
                continue
            expected = self._hash_password(user.salt, password)
            if hmac.compare_digest(user.passwordHash, f"sha256:{expected}"):
                return user
        return None

    def create_access_token(self, user: User) -> str:
        now = int(time.time())
        payload = {
            "sub": user.id,
            "email": user.email,
            "roles": user.roles,
            "iat": now,
            "nbf": now,
            "exp": now + TOKEN_TTL_SECONDS,
            "iss": self.issuer,
            "aud": self.audience,
            "typ": "access",
        }
        return jwt.encode(payload, self.secret, algorithm=self.algorithm)

    def decode_access_token(self, token: str) -> dict[str, Any]:
        try:
            payload = jwt.decode(
                token,
                self.secret,
                algorithms=[self.algorithm],
                issuer=self.issuer,
                audience=self.audience,
                options={"require": ["sub", "email", "roles", "iat", "nbf", "exp", "iss", "aud", "typ"]},
            )
        except jwt.InvalidTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            ) from exc

        if payload.get("typ") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )
        return payload

    @staticmethod
    def to_public_user(user: User) -> UserPublic:
        return UserPublic(
            id=user.id,
            email=user.email,
            displayName=user.displayName,
            roles=user.roles,
        )

    @staticmethod
    def _hash_password(salt: str, password: str) -> str:
        return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def configure_auth_service(auth_service: AuthService) -> None:
    global _auth_service
    _auth_service = auth_service


def require_authenticated_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if _auth_service is None:
        raise RuntimeError("Auth service not configured")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    return _auth_service.decode_access_token(credentials.credentials)
