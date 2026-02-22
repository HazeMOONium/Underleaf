"""Tests for project permission and access control edge cases."""
from app.models.models import User, Permission
from app.core.security import get_password_hash


def _register_and_login(client, email, password="testpass123"):
    """Register a user and return auth headers."""
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_project(client, headers, title="Test Project", visibility="private"):
    resp = client.post(
        "/api/v1/projects",
        json={"title": title, "visibility": visibility},
        headers=headers,
    )
    return resp.json()["id"]


# --- Cross-user access tests ---

def test_user_cannot_see_other_users_private_project(client, db_session):
    headers_a = _register_and_login(client, "alice@example.com")
    headers_b = _register_and_login(client, "bob@example.com")

    project_id = _create_project(client, headers_a)

    resp = client.get(f"/api/v1/projects/{project_id}", headers=headers_b)
    assert resp.status_code == 403


def test_user_cannot_update_other_users_project(client, db_session):
    headers_a = _register_and_login(client, "alice2@example.com")
    headers_b = _register_and_login(client, "bob2@example.com")

    project_id = _create_project(client, headers_a)

    resp = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"title": "Hacked Title"},
        headers=headers_b,
    )
    assert resp.status_code == 403


def test_user_cannot_delete_other_users_project(client, db_session):
    headers_a = _register_and_login(client, "alice3@example.com")
    headers_b = _register_and_login(client, "bob3@example.com")

    project_id = _create_project(client, headers_a)

    resp = client.delete(f"/api/v1/projects/{project_id}", headers=headers_b)
    assert resp.status_code == 403


# --- Shared access via Permission model ---

def test_shared_user_can_view_project(client, db_session):
    headers_a = _register_and_login(client, "owner@example.com")
    headers_b = _register_and_login(client, "viewer@example.com")

    project_id = _create_project(client, headers_a)

    # Manually add a permission for viewer
    viewer = db_session.query(User).filter(User.email == "viewer@example.com").first()
    perm = Permission(project_id=project_id, user_id=viewer.id, role="viewer")
    db_session.add(perm)
    db_session.commit()

    resp = client.get(f"/api/v1/projects/{project_id}", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json()["id"] == project_id


def test_shared_user_cannot_update_project(client, db_session):
    """A viewer with shared access should not be able to update the project."""
    headers_a = _register_and_login(client, "owner2@example.com")
    headers_b = _register_and_login(client, "viewer2@example.com")

    project_id = _create_project(client, headers_a)

    viewer = db_session.query(User).filter(User.email == "viewer2@example.com").first()
    perm = Permission(project_id=project_id, user_id=viewer.id, role="viewer")
    db_session.add(perm)
    db_session.commit()

    resp = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"title": "New Title"},
        headers=headers_b,
    )
    assert resp.status_code == 403


def test_shared_user_cannot_delete_project(client, db_session):
    headers_a = _register_and_login(client, "owner3@example.com")
    headers_b = _register_and_login(client, "viewer3@example.com")

    project_id = _create_project(client, headers_a)

    viewer = db_session.query(User).filter(User.email == "viewer3@example.com").first()
    perm = Permission(project_id=project_id, user_id=viewer.id, role="viewer")
    db_session.add(perm)
    db_session.commit()

    resp = client.delete(f"/api/v1/projects/{project_id}", headers=headers_b)
    assert resp.status_code == 403


def test_shared_projects_appear_in_list(client, db_session):
    """Projects shared with a user should appear in their project list."""
    headers_a = _register_and_login(client, "ownerlist@example.com")
    headers_b = _register_and_login(client, "viewerlist@example.com")

    pid1 = _create_project(client, headers_a, title="Shared Project")
    _create_project(client, headers_a, title="Private Project")

    viewer = db_session.query(User).filter(User.email == "viewerlist@example.com").first()
    perm = Permission(project_id=pid1, user_id=viewer.id, role="viewer")
    db_session.add(perm)
    db_session.commit()

    resp = client.get("/api/v1/projects", headers=headers_b)
    projects = resp.json()
    assert len(projects) == 1
    assert projects[0]["title"] == "Shared Project"


def test_deleting_project_cascades_permissions(client, db_session):
    """When a project is deleted, its permissions should be removed too."""
    headers_a = _register_and_login(client, "cascade_owner@example.com")
    headers_b = _register_and_login(client, "cascade_viewer@example.com")

    project_id = _create_project(client, headers_a)

    viewer = db_session.query(User).filter(User.email == "cascade_viewer@example.com").first()
    perm = Permission(project_id=project_id, user_id=viewer.id, role="viewer")
    db_session.add(perm)
    db_session.commit()

    resp = client.delete(f"/api/v1/projects/{project_id}", headers=headers_a)
    assert resp.status_code == 204

    # Permission should be gone
    remaining = db_session.query(Permission).filter(
        Permission.project_id == project_id
    ).all()
    assert len(remaining) == 0


def test_project_isolation_between_users(client, db_session):
    """User A's projects should not appear in User B's list."""
    headers_a = _register_and_login(client, "iso_a@example.com")
    headers_b = _register_and_login(client, "iso_b@example.com")

    _create_project(client, headers_a, title="A's Project")
    _create_project(client, headers_b, title="B's Project")

    resp_a = client.get("/api/v1/projects", headers=headers_a)
    resp_b = client.get("/api/v1/projects", headers=headers_b)

    assert len(resp_a.json()) == 1
    assert resp_a.json()[0]["title"] == "A's Project"
    assert len(resp_b.json()) == 1
    assert resp_b.json()[0]["title"] == "B's Project"


# --- Visibility tests ---

def test_create_public_project(client, db_session):
    headers = _register_and_login(client, "pub@example.com")
    project_id = _create_project(client, headers, visibility="public")

    resp = client.get(f"/api/v1/projects/{project_id}", headers=headers)
    assert resp.json()["visibility"] == "public"


def test_change_visibility(client, db_session):
    headers = _register_and_login(client, "vis@example.com")
    project_id = _create_project(client, headers, visibility="private")

    resp = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"visibility": "public"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["visibility"] == "public"
