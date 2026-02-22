"""Tests for file CRUD operations on projects."""
from unittest.mock import patch, MagicMock


# --- Helpers ---

def _create_project(client, auth_headers):
    resp = client.post(
        "/api/v1/projects",
        json={"title": "File Test Project"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _mock_minio():
    """Return a patcher that stubs out minio_service methods."""
    storage = {}

    def upload(bucket, key, content):
        storage[key] = content
        return key

    def download(bucket, key):
        if key not in storage:
            raise ConnectionError("not found")
        return storage[key]

    def delete(bucket, key):
        storage.pop(key, None)

    mock = MagicMock()
    mock.upload_file.side_effect = upload
    mock.download_file.side_effect = download
    mock.delete_file.side_effect = delete
    mock._default_bucket = "test-bucket"
    return mock, storage


# --- Tests ---

def test_create_file(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "\\documentclass{article}"},
            headers=auth_headers,
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["path"] == "main.tex"
    assert data["project_id"] == project_id
    assert data["size"] == len("\\documentclass{article}")


def test_list_files(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "hello"},
            headers=auth_headers,
        )
        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "refs.bib", "content": "@article{}"},
            headers=auth_headers,
        )

    resp = client.get(
        f"/api/v1/projects/{project_id}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    files = resp.json()
    assert len(files) == 2
    paths = {f["path"] for f in files}
    assert paths == {"main.tex", "refs.bib"}


def test_get_file_content(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    content = "\\begin{document}Hello\\end{document}"

    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, storage = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.download_file = mock.download_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": content},
            headers=auth_headers,
        )

        resp = client.get(
            f"/api/v1/projects/{project_id}/files/main.tex",
            headers=auth_headers,
        )
    assert resp.status_code == 200
    assert resp.text == content


def test_get_file_not_found(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    resp = client.get(
        f"/api/v1/projects/{project_id}/files/nonexistent.tex",
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_delete_file(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "x"},
            headers=auth_headers,
        )

        resp = client.delete(
            f"/api/v1/projects/{project_id}/files/main.tex",
            headers=auth_headers,
        )
    assert resp.status_code == 204

    # Verify file is gone from DB
    resp = client.get(
        f"/api/v1/projects/{project_id}/files",
        headers=auth_headers,
    )
    assert len(resp.json()) == 0


def test_delete_file_not_found(client, test_user, auth_headers):
    project_id = _create_project(client, auth_headers)
    resp = client.delete(
        f"/api/v1/projects/{project_id}/files/ghost.tex",
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_update_file_via_post(client, test_user, auth_headers):
    """POST to existing path should update the file, not create a duplicate."""
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, storage = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.download_file = mock.download_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "v1"},
            headers=auth_headers,
        )
        resp = client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "v2"},
            headers=auth_headers,
        )
    assert resp.status_code == 201
    assert resp.json()["size"] == 2  # len("v2")

    # Should still be only 1 file
    files_resp = client.get(
        f"/api/v1/projects/{project_id}/files",
        headers=auth_headers,
    )
    assert len(files_resp.json()) == 1


def test_file_access_denied_other_user(client, db_session, test_user, auth_headers):
    """Another user should not be able to list files of a project they don't own."""
    from app.models.models import User
    from app.core.security import get_password_hash

    project_id = _create_project(client, auth_headers)

    # Create second user
    other = User(email="other@example.com", hashed_password=get_password_hash("pass123"))
    db_session.add(other)
    db_session.commit()

    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": "other@example.com", "password": "pass123"},
    )
    other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = client.get(
        f"/api/v1/projects/{project_id}/files",
        headers=other_headers,
    )
    assert resp.status_code == 403


def test_create_file_empty_content(client, test_user, auth_headers):
    """Creating a file with empty/null content should succeed."""
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "empty.tex"},
            headers=auth_headers,
        )
    assert resp.status_code == 201
    assert resp.json()["size"] == 0


def test_create_file_with_subdirectory_path(client, test_user, auth_headers):
    """Files with nested paths like 'chapters/intro.tex' should work."""
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "chapters/intro.tex", "content": "intro"},
            headers=auth_headers,
        )
    assert resp.status_code == 201
    assert resp.json()["path"] == "chapters/intro.tex"


def test_file_on_nonexistent_project(client, test_user, auth_headers):
    """File operations on a non-existent project should return 404."""
    resp = client.get(
        "/api/v1/projects/nonexistent-id/files",
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_file_minio_upload_failure(client, test_user, auth_headers):
    """If MinIO upload fails, the API should return 500."""
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock_minio.upload_file.side_effect = Exception("MinIO down")
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "main.tex", "content": "test"},
            headers=auth_headers,
        )
    assert resp.status_code == 500
    assert "Failed to upload file" in resp.json()["detail"]
