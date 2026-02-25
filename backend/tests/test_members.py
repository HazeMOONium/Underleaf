"""Tests for project members API: list, add, update role, remove."""
from app.models.models import User
from app.core.security import get_password_hash


def _register_and_login(client, email, password="pass12345"):
    client.post("/api/v1/auth/register", json={"email": email, "password": password})
    resp = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_project(client, headers):
    resp = client.post("/api/v1/projects", json={"title": "Members Test"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── list members ──────────────────────────────────────────────────────────────

def test_list_members_owner_only(client, db_session):
    owner_headers = _register_and_login(client, "owner_lm@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.get(f"/api/v1/projects/{project_id}/members", headers=owner_headers)
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 1
    assert members[0]["role"] == "owner"


def test_list_members_includes_added_member(client, db_session):
    owner_headers = _register_and_login(client, "owner_lm2@example.com")
    _register_and_login(client, "editor_lm@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "editor_lm@example.com", "role": "editor"},
        headers=owner_headers,
    )

    resp = client.get(f"/api/v1/projects/{project_id}/members", headers=owner_headers)
    emails = {m["email"] for m in resp.json()}
    roles = {m["role"] for m in resp.json()}
    assert "editor_lm@example.com" in emails
    assert "editor" in roles


# ── add member ────────────────────────────────────────────────────────────────

def test_add_member_success(client, db_session):
    owner_headers = _register_and_login(client, "owner_am@example.com")
    _register_and_login(client, "newmember@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "newmember@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "viewer"
    assert resp.json()["email"] == "newmember@example.com"


def test_add_member_non_owner_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_am2@example.com")
    viewer_headers = _register_and_login(client, "viewer_am@example.com")
    _register_and_login(client, "target_am@example.com")
    project_id = _create_project(client, owner_headers)

    # Give viewer access first
    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "viewer_am@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "target_am@example.com", "role": "editor"},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


def test_add_member_unknown_user(client, db_session):
    owner_headers = _register_and_login(client, "owner_am3@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "ghost@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    assert resp.status_code == 404


def test_add_member_invalid_role(client, db_session):
    owner_headers = _register_and_login(client, "owner_am4@example.com")
    _register_and_login(client, "target_am4@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "target_am4@example.com", "role": "superadmin"},
        headers=owner_headers,
    )
    assert resp.status_code == 400


def test_add_member_cannot_assign_owner_role(client, db_session):
    owner_headers = _register_and_login(client, "owner_am5@example.com")
    _register_and_login(client, "target_am5@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "target_am5@example.com", "role": "owner"},
        headers=owner_headers,
    )
    assert resp.status_code == 400


def test_add_self_as_member_forbidden(client, db_session):
    headers = _register_and_login(client, "owner_self@example.com")
    project_id = _create_project(client, headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "owner_self@example.com", "role": "editor"},
        headers=headers,
    )
    assert resp.status_code == 400


# ── update role ────────────────────────────────────────────────────────────────

def test_update_member_role(client, db_session):
    owner_headers = _register_and_login(client, "owner_ur@example.com")
    member_headers = _register_and_login(client, "member_ur@example.com")
    project_id = _create_project(client, owner_headers)

    add_resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "member_ur@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    user_id = add_resp.json()["user_id"]

    resp = client.patch(
        f"/api/v1/projects/{project_id}/members/{user_id}",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


def test_update_owner_role_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_uor@example.com")
    project_id = _create_project(client, owner_headers)

    # Get owner user_id from members list
    members = client.get(f"/api/v1/projects/{project_id}/members", headers=owner_headers).json()
    owner_user_id = members[0]["user_id"]

    resp = client.patch(
        f"/api/v1/projects/{project_id}/members/{owner_user_id}",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert resp.status_code == 400


# ── remove member ─────────────────────────────────────────────────────────────

def test_remove_member_success(client, db_session):
    owner_headers = _register_and_login(client, "owner_rm@example.com")
    _register_and_login(client, "member_rm@example.com")
    project_id = _create_project(client, owner_headers)

    add_resp = client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "member_rm@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    user_id = add_resp.json()["user_id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/members/{user_id}",
        headers=owner_headers,
    )
    assert resp.status_code == 204

    members = client.get(
        f"/api/v1/projects/{project_id}/members", headers=owner_headers
    ).json()
    assert all(m["user_id"] != user_id for m in members)


def test_remove_owner_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_rof@example.com")
    project_id = _create_project(client, owner_headers)

    members = client.get(f"/api/v1/projects/{project_id}/members", headers=owner_headers).json()
    owner_user_id = members[0]["user_id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/members/{owner_user_id}",
        headers=owner_headers,
    )
    assert resp.status_code == 400


def test_remove_nonexistent_member(client, db_session):
    owner_headers = _register_and_login(client, "owner_rnm@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.delete(
        f"/api/v1/projects/{project_id}/members/nonexistent-user-id",
        headers=owner_headers,
    )
    assert resp.status_code == 404
