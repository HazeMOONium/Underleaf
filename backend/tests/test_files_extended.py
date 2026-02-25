"""Tests for extended file operations: binary upload, ZIP export, rename."""
import base64
import zipfile
import io
from unittest.mock import MagicMock, patch


def _create_project(client, auth_headers):
    resp = client.post(
        "/api/v1/projects",
        json={"title": "File Ext Test"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _mock_minio():
    storage = {}

    def upload(bucket, key, content):
        if isinstance(content, str):
            content = content.encode()
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


# ── binary upload ─────────────────────────────────────────────────────────────

def test_binary_upload_success(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50  # fake PNG header
    content_b64 = base64.b64encode(png_bytes).decode()

    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files/upload",
            json={"path": "images/logo.png", "content_base64": content_b64},
            headers=auth_headers,
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["path"] == "images/logo.png"
    assert data["size"] == len(png_bytes)


def test_binary_upload_invalid_base64(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio._default_bucket = "test-bucket"

        resp = client.post(
            f"/api/v1/projects/{project_id}/files/upload",
            json={"path": "broken.png", "content_base64": "!!!not-valid-base64!!!"},
            headers=auth_headers,
        )
    assert resp.status_code == 400
    assert "base64" in resp.json()["detail"].lower()


def test_binary_upload_unauthenticated(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    resp = client.post(
        f"/api/v1/projects/{project_id}/files/upload",
        json={"path": "file.png", "content_base64": "dGVzdA=="},
    )
    assert resp.status_code == 401


def test_binary_upload_updates_existing(client, auth_headers):
    """Uploading to the same path twice should update, not duplicate."""
    project_id = _create_project(client, auth_headers)
    b64_v1 = base64.b64encode(b"version1").decode()
    b64_v2 = base64.b64encode(b"version2-longer").decode()

    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files/upload",
            json={"path": "data.bin", "content_base64": b64_v1},
            headers=auth_headers,
        )
        resp = client.post(
            f"/api/v1/projects/{project_id}/files/upload",
            json={"path": "data.bin", "content_base64": b64_v2},
            headers=auth_headers,
        )

    assert resp.status_code == 201
    assert resp.json()["size"] == len(b"version2-longer")

    # Still only one file with that path
    files_resp = client.get(
        f"/api/v1/projects/{project_id}/files",
        headers=auth_headers,
    )
    paths = [f["path"] for f in files_resp.json()]
    assert paths.count("data.bin") == 1


# ── ZIP export ────────────────────────────────────────────────────────────────

def test_zip_export_empty_project(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio._default_bucket = "test-bucket"

        resp = client.get(
            f"/api/v1/projects/{project_id}/export/zip",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    # Should be a valid (empty) ZIP
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert zf.namelist() == []


def test_zip_export_with_files(client, auth_headers):
    project_id = _create_project(client, auth_headers)

    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, storage = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.download_file = mock.download_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        # Create two text files
        for path, content in [("main.tex", "\\documentclass{article}"), ("refs.bib", "@article{}")]:
            client.post(
                f"/api/v1/projects/{project_id}/files",
                json={"path": path, "content": content},
                headers=auth_headers,
            )

        resp = client.get(
            f"/api/v1/projects/{project_id}/export/zip",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert "main.tex" in names
    assert "refs.bib" in names
    assert zf.read("main.tex") == b"\\documentclass{article}"


def test_zip_export_access_denied(client, db_session, auth_headers):
    """Another user should not be able to export a project they don't have access to."""
    from app.models.models import User
    from app.core.security import get_password_hash

    project_id = _create_project(client, auth_headers)

    other = User(email="nozip@example.com", hashed_password=get_password_hash("pass123"))
    db_session.add(other)
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        data={"username": "nozip@example.com", "password": "pass123"},
    )
    other_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = client.get(
        f"/api/v1/projects/{project_id}/export/zip",
        headers=other_headers,
    )
    assert resp.status_code == 403


def test_zip_export_unauthenticated(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    resp = client.get(f"/api/v1/projects/{project_id}/export/zip")
    assert resp.status_code == 401


# ── rename file ───────────────────────────────────────────────────────────────

def test_rename_file_success(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.download_file = mock.download_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        client.post(
            f"/api/v1/projects/{project_id}/files",
            json={"path": "old.tex", "content": "hello"},
            headers=auth_headers,
        )

        resp = client.patch(
            f"/api/v1/projects/{project_id}/files/old.tex",
            json={"new_path": "new.tex"},
            headers=auth_headers,
        )

    assert resp.status_code == 200
    assert resp.json()["path"] == "new.tex"


def test_rename_file_not_found(client, auth_headers):
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio._default_bucket = "test-bucket"

        resp = client.patch(
            f"/api/v1/projects/{project_id}/files/ghost.tex",
            json={"new_path": "renamed.tex"},
            headers=auth_headers,
        )

    assert resp.status_code == 404


def test_rename_file_conflict(client, auth_headers):
    """Renaming to an existing file path should return 409."""
    project_id = _create_project(client, auth_headers)
    with patch("app.api.v1.projects.minio_service") as mock_minio:
        mock, _ = _mock_minio()
        mock_minio.upload_file = mock.upload_file
        mock_minio.download_file = mock.download_file
        mock_minio.delete_file = mock.delete_file
        mock_minio._default_bucket = "test-bucket"

        for path in ["a.tex", "b.tex"]:
            client.post(
                f"/api/v1/projects/{project_id}/files",
                json={"path": path, "content": "x"},
                headers=auth_headers,
            )

        resp = client.patch(
            f"/api/v1/projects/{project_id}/files/a.tex",
            json={"new_path": "b.tex"},
            headers=auth_headers,
        )

    assert resp.status_code == 409
