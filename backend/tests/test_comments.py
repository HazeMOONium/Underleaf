"""Tests for project comments API: create, list, reply, resolve, delete."""


def _register_and_login(client, email, password="pass12345"):
    client.post("/api/v1/auth/register", json={"email": email, "password": password})
    resp = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_project(client, headers):
    resp = client.post("/api/v1/projects", json={"title": "Comments Test"}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── create comment ────────────────────────────────────────────────────────────

def test_create_comment_success(client, db_session):
    owner_headers = _register_and_login(client, "owner_cc@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 10, "content": "Fix this equation"},
        headers=owner_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "Fix this equation"
    assert data["file_path"] == "main.tex"
    assert data["line"] == 10
    assert data["replies"] == []
    assert data["resolved_at"] is None


def test_create_comment_viewer_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_ccv@example.com")
    viewer_headers = _register_and_login(client, "viewer_ccv@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "viewer_ccv@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "I can see this"},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


def test_create_comment_commenter_allowed(client, db_session):
    owner_headers = _register_and_login(client, "owner_ccc@example.com")
    commenter_headers = _register_and_login(client, "commenter_ccc@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "commenter_ccc@example.com", "role": "commenter"},
        headers=owner_headers,
    )

    resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 5, "content": "Looks good"},
        headers=commenter_headers,
    )
    assert resp.status_code == 201


def test_create_comment_unauthenticated(client, db_session):
    owner_headers = _register_and_login(client, "owner_ccu@example.com")
    project_id = _create_project(client, owner_headers)

    resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "anon"},
    )
    assert resp.status_code == 401


# ── list comments ─────────────────────────────────────────────────────────────

def test_list_comments(client, db_session):
    owner_headers = _register_and_login(client, "owner_lc@example.com")
    project_id = _create_project(client, owner_headers)

    for i in range(3):
        client.post(
            f"/api/v1/projects/{project_id}/comments",
            json={"file_path": "main.tex", "line": i, "content": f"comment {i}"},
            headers=owner_headers,
        )

    resp = client.get(f"/api/v1/projects/{project_id}/comments", headers=owner_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3


def test_list_comments_filter_by_file(client, db_session):
    owner_headers = _register_and_login(client, "owner_lcff@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "in main"},
        headers=owner_headers,
    )
    client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "refs.bib", "line": 1, "content": "in refs"},
        headers=owner_headers,
    )

    resp = client.get(
        f"/api/v1/projects/{project_id}/comments?file_path=main.tex",
        headers=owner_headers,
    )
    assert resp.status_code == 200
    comments = resp.json()
    assert len(comments) == 1
    assert comments[0]["file_path"] == "main.tex"


# ── reply to comment ──────────────────────────────────────────────────────────

def test_reply_to_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_rc@example.com")
    project_id = _create_project(client, owner_headers)

    parent_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 3, "content": "Top-level"},
        headers=owner_headers,
    )
    parent_id = parent_resp.json()["id"]

    reply_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 3, "content": "Reply here", "parent_id": parent_id},
        headers=owner_headers,
    )
    assert reply_resp.status_code == 201
    assert reply_resp.json()["parent_id"] == parent_id

    # Parent should now include the reply
    list_resp = client.get(f"/api/v1/projects/{project_id}/comments", headers=owner_headers)
    top_level = [c for c in list_resp.json() if c["id"] == parent_id]
    assert len(top_level) == 1
    assert len(top_level[0]["replies"]) == 1
    assert top_level[0]["replies"][0]["content"] == "Reply here"


def test_cannot_nest_reply_inside_reply(client, db_session):
    owner_headers = _register_and_login(client, "owner_nrir@example.com")
    project_id = _create_project(client, owner_headers)

    parent_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Root"},
        headers=owner_headers,
    )
    parent_id = parent_resp.json()["id"]

    reply_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Reply", "parent_id": parent_id},
        headers=owner_headers,
    )
    reply_id = reply_resp.json()["id"]

    nested_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Nested", "parent_id": reply_id},
        headers=owner_headers,
    )
    assert nested_resp.status_code == 400


# ── resolve / unresolve comment ───────────────────────────────────────────────

def test_resolve_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_res@example.com")
    project_id = _create_project(client, owner_headers)

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Needs fixing"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.patch(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        json={"resolved": True},
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["resolved_at"] is not None


def test_unresolve_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_unres@example.com")
    project_id = _create_project(client, owner_headers)

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 2, "content": "Resolved later"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    client.patch(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        json={"resolved": True},
        headers=owner_headers,
    )
    resp = client.patch(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        json={"resolved": False},
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["resolved_at"] is None


# ── edit comment content ──────────────────────────────────────────────────────

def test_edit_own_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_eoc@example.com")
    project_id = _create_project(client, owner_headers)

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Old content"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.patch(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        json={"content": "New content"},
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "New content"


def test_edit_other_users_comment_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_eouc@example.com")
    editor_headers = _register_and_login(client, "editor_eouc@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "editor_eouc@example.com", "role": "editor"},
        headers=owner_headers,
    )

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Owner's comment"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.patch(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        json={"content": "Stolen edit"},
        headers=editor_headers,
    )
    assert resp.status_code == 403


# ── delete comment ────────────────────────────────────────────────────────────

def test_delete_own_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_doc@example.com")
    project_id = _create_project(client, owner_headers)

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "To be deleted"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        headers=owner_headers,
    )
    assert resp.status_code == 204

    list_resp = client.get(f"/api/v1/projects/{project_id}/comments", headers=owner_headers)
    assert all(c["id"] != comment_id for c in list_resp.json())


def test_delete_other_users_comment_as_non_owner_forbidden(client, db_session):
    owner_headers = _register_and_login(client, "owner_douanof@example.com")
    editor_headers = _register_and_login(client, "editor_douanof@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "editor_douanof@example.com", "role": "editor"},
        headers=owner_headers,
    )

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Owner wrote this"},
        headers=owner_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        headers=editor_headers,
    )
    assert resp.status_code == 403


def test_project_owner_can_delete_any_comment(client, db_session):
    owner_headers = _register_and_login(client, "owner_pocdc@example.com")
    editor_headers = _register_and_login(client, "editor_pocdc@example.com")
    project_id = _create_project(client, owner_headers)

    client.post(
        f"/api/v1/projects/{project_id}/members",
        json={"email": "editor_pocdc@example.com", "role": "editor"},
        headers=owner_headers,
    )

    comment_resp = client.post(
        f"/api/v1/projects/{project_id}/comments",
        json={"file_path": "main.tex", "line": 1, "content": "Editor's comment"},
        headers=editor_headers,
    )
    comment_id = comment_resp.json()["id"]

    resp = client.delete(
        f"/api/v1/projects/{project_id}/comments/{comment_id}",
        headers=owner_headers,
    )
    assert resp.status_code == 204
