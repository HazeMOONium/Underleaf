"""Tests for project invites API: create, list, revoke, preview, accept."""
from datetime import datetime, timedelta, timezone


def _register_and_login(client, email, password="pass12345"):
    client.post("/api/v1/auth/register", json={"email": email, "password": password})
    resp = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_project(client, headers):
    resp = client.post("/api/v1/projects", json={"title": "Invite Test"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── create invite ─────────────────────────────────────────────────────────────

def test_create_invite_success(client, db_session):
    owner_headers = _register_and_login(client, "owner_ci@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["role"] == "editor"
    assert "token" in data
    assert data["use_count"] == 0


def test_create_invite_with_expiry(client, db_session):
    owner_headers = _register_and_login(client, "owner_ci2@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "viewer", "expires_hours": 24, "max_uses": 5},
        headers=owner_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["max_uses"] == 5
    assert data["expires_at"] is not None


def test_create_invite_owner_role_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_ci3@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "owner"},
        headers=owner_headers,
    )
    assert resp.status_code == 400


def test_create_invite_non_owner_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_ci4@example.com")
    viewer_headers = _register_and_login(client, "viewer_ci4@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "viewer_ci4@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "editor"},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


# ── list invites ──────────────────────────────────────────────────────────────

def test_list_invites(client, db_session):
    owner_headers = _register_and_login(client, "owner_li@example.com")
    project_id = _create_project(client, owner_headers)

    for role in ("editor", "viewer"):
        client.post(
            f"/api/v1/projects/{project_id}/invites",
            json={"role": role},
            headers=owner_headers,
        )

    resp = client.get(
        f"/api/v1/projects/{project_id}/invites",
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# ── revoke invite ─────────────────────────────────────────────────────────────

def test_revoke_invite(client, db_session):
    owner_headers = _register_and_login(client, "owner_ri@example.com")
    project_id = _create_project(client, owner_headers)

    create_resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "viewer"},
        headers=owner_headers,
    )
    invite_id = create_resp.json()["id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/invites/{invite_id}",
        headers=owner_headers,
    )
    assert resp.status_code == 204

    list_resp = client.get(
        f"/api/v1/projects/{project_id}/invites",
        headers=owner_headers,
    )
    assert all(i["id"] != invite_id for i in list_resp.json())


def test_revoke_nonexistent_invite(client, db_session):
    owner_headers = _register_and_login(client, "owner_rni@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.delete(
        f"/api/v1/projects/{project_id}/invites/nonexistent-id",
        headers=owner_headers,
    )
    assert resp.status_code == 404


# ── preview invite (public) ───────────────────────────────────────────────────

def test_preview_invite(client, db_session):
    owner_headers = _register_and_login(client, "owner_pi@example.com")
    project_id = _create_project(client, owner_headers)

    create_resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "editor"},
        headers=owner_headers,
    )
    token = create_resp.json()["token"]

    # Preview is public — no auth needed
    resp = client.get(f"/api/v1/invites/{token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "editor"
    assert data["project_title"] == "Invite Test"


def test_preview_invalid_token(client):
    resp = client.get("/api/v1/invites/not-a-real-token")
    assert resp.status_code == 404


# ── accept invite ─────────────────────────────────────────────────────────────

def test_accept_invite_success(client, db_session):
    owner_headers = _register_and_login(client, "owner_ai@example.com")
    new_member_headers = _register_and_login(client, "newmember_ai@example.com")
    project_id = _create_project(client, owner_headers)

    create_resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "editor"},
        headers=owner_headers,
    )
    token = create_resp.json()["token"]

    resp = client.post(f"/api/v1/invites/{token}/accept", headers=new_member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "editor"
    assert data["email"] == "newmember_ai@example.com"

    # Verify the new member now appears in the members list
    members = client.get(
        f"/api/v1/projects/{project_id}/members",
        headers=owner_headers,
    ).json()
    emails = {m["email"] for m in members}
    assert "newmember_ai@example.com" in emails


def test_accept_invite_owner_cannot_accept_own(client, db_session):
    owner_headers = _register_and_login(client, "owner_acoo@example.com")
    project_id = _create_project(client, owner_headers)

    create_resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "editor"},
        headers=owner_headers,
    )
    token = create_resp.json()["token"]

    resp = client.post(f"/api/v1/invites/{token}/accept", headers=owner_headers)
    assert resp.status_code == 400


def test_accept_invite_increments_use_count(client, db_session):
    owner_headers = _register_and_login(client, "owner_aiuc@example.com")
    member_headers = _register_and_login(client, "member_aiuc@example.com")
    project_id = _create_project(client, owner_headers)

    create_resp = client.post(
        f"/api/v1/projects/{project_id}/invites",
        json={"role": "viewer", "max_uses": 3},
        headers=owner_headers,
    )
    token = create_resp.json()["token"]

    client.post(f"/api/v1/invites/{token}/accept", headers=member_headers)

    invites = client.get(
        f"/api/v1/projects/{project_id}/invites",
        headers=owner_headers,
    ).json()
    matching = [i for i in invites if i["token"] == token]
    assert matching[0]["use_count"] == 1
