"""Tests for new auth endpoints: change-password, verify-email, forgot-password, reset-password."""
from unittest.mock import AsyncMock, patch

from app.core.security import get_password_hash
from app.models.models import User


# ── change password ──────────────────────────────────────────────────────────

def test_change_password_success(client, test_user, auth_headers):
    resp = client.put(
        "/api/v1/auth/me/password",
        json={"current_password": "testpassword123", "new_password": "newpassword456"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["detail"] == "Password changed successfully"


def test_change_password_wrong_current(client, test_user, auth_headers):
    resp = client.put(
        "/api/v1/auth/me/password",
        json={"current_password": "WRONG", "new_password": "newpassword456"},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "incorrect" in resp.json()["detail"].lower()


def test_change_password_then_login_with_new(client, db_session, test_user, auth_headers):
    """After a successful change, the user should be able to log in with the new password."""
    client.put(
        "/api/v1/auth/me/password",
        json={"current_password": "testpassword123", "new_password": "supersecure999"},
        headers=auth_headers,
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": test_user.email, "password": "supersecure999"},
    )
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.json()


def test_change_password_unauthenticated(client):
    resp = client.put(
        "/api/v1/auth/me/password",
        json={"current_password": "x", "new_password": "y"},
    )
    assert resp.status_code == 401


# ── verify-email ─────────────────────────────────────────────────────────────

def test_verify_email_success(client, db_session):
    """A valid verify-email token should mark the user as verified."""
    user = User(
        email="toverify@example.com",
        hashed_password=get_password_hash("pass1234"),
        email_verified=False,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    fake_token = "valid-verify-token-abc"

    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value=str(user.id),
    ), patch(
        "app.api.v1.auth.redis_service.delete",
        new_callable=AsyncMock,
    ):
        resp = client.post("/api/v1/auth/verify-email", json={"token": fake_token})

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Email verified successfully"

    db_session.refresh(user)
    assert user.email_verified is True


def test_verify_email_invalid_token(client):
    """An unknown token should return 400."""
    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.post("/api/v1/auth/verify-email", json={"token": "unknown-token"})

    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


def test_verify_email_nonexistent_user(client, db_session):
    """Token resolves to a user_id that no longer exists — should return 400."""
    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value="nonexistent-user-id",
    ):
        resp = client.post("/api/v1/auth/verify-email", json={"token": "orphan-token"})

    assert resp.status_code == 400


# ── forgot-password ──────────────────────────────────────────────────────────

def test_forgot_password_known_email(client, test_user):
    """Should always return 200 regardless of whether the email exists (anti-enumeration)."""
    with patch(
        "app.api.v1.auth.redis_service.set",
        new_callable=AsyncMock,
    ), patch(
        "app.api.v1.auth.send_password_reset_email",
    ):
        resp = client.post(
            "/api/v1/auth/forgot-password",
            json={"email": test_user.email},
        )

    assert resp.status_code == 200
    assert "reset link" in resp.json()["detail"].lower()


def test_forgot_password_unknown_email(client):
    """Unknown email should still return 200 to prevent enumeration."""
    resp = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "nobody@example.com"},
    )
    assert resp.status_code == 200
    assert "reset link" in resp.json()["detail"].lower()


def test_forgot_password_invalid_email(client):
    resp = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "not-an-email"},
    )
    assert resp.status_code == 422


# ── reset-password ────────────────────────────────────────────────────────────

def test_reset_password_success(client, db_session, test_user):
    """Valid reset token should update the password."""
    fake_token = "valid-reset-token-xyz"

    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value=str(test_user.id),
    ), patch(
        "app.api.v1.auth.redis_service.delete",
        new_callable=AsyncMock,
    ):
        resp = client.post(
            "/api/v1/auth/reset-password",
            json={"token": fake_token, "new_password": "resetpass999"},
        )

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Password updated successfully"

    # Login with new password should work
    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": test_user.email, "password": "resetpass999"},
    )
    assert login_resp.status_code == 200


def test_reset_password_invalid_token(client):
    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.post(
            "/api/v1/auth/reset-password",
            json={"token": "bad-token", "new_password": "something"},
        )
    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


def test_reset_password_short_password(client):
    """Passwords shorter than min length (6) should be rejected by Pydantic."""
    with patch(
        "app.api.v1.auth.redis_service.get",
        new_callable=AsyncMock,
        return_value="some-user-id",
    ), patch(
        "app.api.v1.auth.redis_service.delete",
        new_callable=AsyncMock,
    ):
        resp = client.post(
            "/api/v1/auth/reset-password",
            json={"token": "tok", "new_password": "ab"},
        )
    assert resp.status_code == 422
