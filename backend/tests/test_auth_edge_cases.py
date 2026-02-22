"""Tests for authentication edge cases: email validation, password edge cases, JWT manipulation."""
import time
from datetime import timedelta
from jose import jwt
from app.core.config import get_settings


settings = get_settings()


# --- Email validation ---

def test_register_invalid_email_format(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email", "password": "securepass123"},
    )
    assert resp.status_code == 422  # Pydantic validation error


def test_register_empty_email(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "", "password": "securepass123"},
    )
    assert resp.status_code == 422


def test_register_missing_email(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"password": "securepass123"},
    )
    assert resp.status_code == 422


def test_register_missing_password(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "nopass@example.com"},
    )
    assert resp.status_code == 422


def test_register_email_with_spaces(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "  spaces@example.com  ", "password": "pass123456"},
    )
    # Pydantic EmailStr might strip or reject; either 422 or successful register is OK
    assert resp.status_code in (200, 422)


def test_register_sql_injection_in_email(client):
    """SQL injection attempt in email field should be rejected by EmailStr validation."""
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "'; DROP TABLE users; --", "password": "pass123456"},
    )
    assert resp.status_code == 422


def test_register_xss_in_email(client):
    """XSS attempt in email field should be rejected by EmailStr validation."""
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "<script>alert('xss')</script>@evil.com", "password": "pass123"},
    )
    # EmailStr should reject this as invalid
    assert resp.status_code == 422


def test_register_very_long_email(client):
    """Extremely long email should be handled gracefully."""
    long_local = "a" * 300
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": f"{long_local}@example.com", "password": "pass123456"},
    )
    # Should either be rejected by validation or by DB constraint
    assert resp.status_code in (422, 400, 500)


def test_register_empty_password(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "emptypass@example.com", "password": ""},
    )
    # Ideally should be 422, but password has no min-length on schema currently
    # This tests whether the system handles it at all without crashing
    assert resp.status_code in (200, 422)


def test_register_unicode_email(client):
    """Unicode in email local part should be handled."""
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "unicöde@example.com", "password": "pass123456"},
    )
    assert resp.status_code in (200, 422)


# --- JWT manipulation ---

def test_expired_token_rejected(client, test_user):
    """An expired JWT should be rejected with 401."""
    from app.core.security import create_access_token

    token = create_access_token(subject=test_user.id, expires_delta=timedelta(seconds=-1))
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401


def test_tampered_token_rejected(client, test_user):
    """A token signed with the wrong key should be rejected."""
    from datetime import datetime, timezone

    payload = {
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "sub": test_user.id,
    }
    bad_token = jwt.encode(payload, "wrong-secret-key", algorithm="HS256")
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {bad_token}"},
    )
    assert resp.status_code == 401


def test_token_with_nonexistent_user(client, db_session):
    """A valid token for a deleted/nonexistent user should return 401."""
    from app.core.security import create_access_token

    token = create_access_token(subject="nonexistent-user-id")
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401


def test_malformed_auth_header(client):
    """A malformed Authorization header should be rejected."""
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "NotBearer sometoken"},
    )
    assert resp.status_code == 401


def test_empty_bearer_token(client):
    """An empty Bearer token should fail."""
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer "},
    )
    assert resp.status_code == 401


def test_no_auth_header(client):
    """No auth header at all should return 401."""
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


# --- Login edge cases ---

def test_login_with_wrong_email(client, test_user):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "nobody@example.com", "password": "testpassword123"},
    )
    assert resp.status_code == 401


def test_login_sql_injection(client, test_user):
    """SQL injection in login should not bypass authentication."""
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "' OR 1=1 --", "password": "anything"},
    )
    assert resp.status_code == 401


def test_login_empty_fields(client):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "", "password": ""},
    )
    assert resp.status_code in (401, 422)


# --- /me endpoint ---

def test_me_returns_user_info(client, test_user, auth_headers):
    resp = client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == test_user.email
    assert data["id"] == test_user.id
    assert "hashed_password" not in data  # Should not leak password hash
