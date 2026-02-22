import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import status

from app.models.models import Project, CompileJob, JobStatus


def _create_project(db_session, owner_id, title="Compile Test Project"):
    """Helper to create a project in the DB for compile tests."""
    project = Project(
        owner_id=owner_id,
        title=title,
        visibility="private",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


def _create_compile_job(db_session, project_id, job_status=JobStatus.PENDING):
    """Helper to create a compile job directly in the DB."""
    job = CompileJob(
        project_id=project_id,
        status=job_status,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_create_compile_job(mock_publish, client, auth_headers, test_user, db_session):
    """Creating a compile job for an existing project should succeed and publish to RabbitMQ."""
    project = _create_project(db_session, test_user.id)

    response = client.post(
        "/api/v1/compile/jobs",
        json={"project_id": project.id},
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["project_id"] == project.id
    assert data["status"] == "pending"
    assert "id" in data
    assert "created_at" in data

    # Verify that RabbitMQ publish was called once with expected arguments
    mock_publish.assert_called_once()
    call_args = mock_publish.call_args
    assert call_args[0][0] == "compile_jobs"  # queue name
    message = call_args[0][1]
    assert message["job_id"] == data["id"]
    assert message["project_id"] == project.id


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_create_compile_job_project_not_found(mock_publish, client, auth_headers):
    """Creating a compile job for a non-existent project should return 404."""
    response = client.post(
        "/api/v1/compile/jobs",
        json={"project_id": "nonexistent-project-id"},
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "Project not found" in response.json()["detail"]

    # RabbitMQ should never be called if the project doesn't exist
    mock_publish.assert_not_called()


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching a compile job by ID should return the job details."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id)

    response = client.get(
        f"/api/v1/compile/jobs/{job.id}",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == job.id
    assert data["project_id"] == project.id
    assert data["status"] == "pending"


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_not_found(mock_publish, client, auth_headers):
    """Fetching a non-existent compile job should return 404."""
    response = client.get(
        "/api/v1/compile/jobs/nonexistent-job-id",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "Job not found" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_status(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching the status endpoint should return id, status, error_message, and finished_at."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id, job_status=JobStatus.PENDING)

    response = client.get(
        f"/api/v1/compile/jobs/{job.id}/status",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == job.id
    assert data["status"] == "pending"
    assert data["error_message"] is None
    assert data["finished_at"] is None


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_create_compile_job_unauthenticated(mock_publish, client, test_user, db_session):
    """Creating a compile job without auth headers should return 401."""
    project = _create_project(db_session, test_user.id)

    response = client.post(
        "/api/v1/compile/jobs",
        json={"project_id": project.id},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    mock_publish.assert_not_called()


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
    side_effect=ConnectionError("RabbitMQ unavailable"),
)
def test_create_compile_job_rabbitmq_failure(
    mock_publish, client, auth_headers, test_user, db_session
):
    """When RabbitMQ publish fails with ConnectionError, the endpoint should return 503."""
    project = _create_project(db_session, test_user.id)

    response = client.post(
        "/api/v1/compile/jobs",
        json={"project_id": project.id},
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "Failed to queue compile job" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_status_not_found(mock_publish, client, auth_headers):
    """Fetching status for a non-existent job should return 404."""
    response = client.get(
        "/api/v1/compile/jobs/nonexistent-job-id/status",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "Job not found" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_no_access(mock_publish, client, auth_headers, test_user, db_session):
    """A user who doesn't own the project (and has no permission) should get 403 on job fetch."""
    from app.core.security import get_password_hash
    from app.models.models import User

    # Create a second user who owns the project
    other_user = User(
        email="otherowner@example.com",
        hashed_password=get_password_hash("otherpassword123"),
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)

    project = _create_project(db_session, other_user.id, title="Other's Project")
    job = _create_compile_job(db_session, project.id)

    # test_user (via auth_headers) should be denied
    response = client.get(
        f"/api/v1/compile/jobs/{job.id}",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "Access denied" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_artifact(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching the artifact for a completed job should return the PDF."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id, job_status=JobStatus.COMPLETED)
    job.artifact_ref = f"artifacts/{job.id}/output.pdf"
    db_session.commit()

    with patch("app.api.v1.compile.minio_service") as mock_minio:
        mock_minio.download_file.return_value = b"%PDF-1.4 fake pdf content"
        mock_minio._default_bucket = "underleaf-files"

        response = client.get(
            f"/api/v1/compile/jobs/{job.id}/artifact",
            headers=auth_headers,
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["content-type"] == "application/pdf"
    assert b"%PDF-1.4" in response.content


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_artifact_no_artifact(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching artifact for a job with no artifact_ref should return 404."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id, job_status=JobStatus.PENDING)

    response = client.get(
        f"/api/v1/compile/jobs/{job.id}/artifact",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "No artifact available" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_logs(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching the logs for a job with logs_ref should return log content."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id, job_status=JobStatus.COMPLETED)
    job.logs_ref = f"artifacts/{job.id}/compile.log"
    db_session.commit()

    with patch("app.api.v1.compile.minio_service") as mock_minio:
        mock_minio.download_file.return_value = b"This is pdflatex output\nCompilation successful"
        mock_minio._default_bucket = "underleaf-files"

        response = client.get(
            f"/api/v1/compile/jobs/{job.id}/logs",
            headers=auth_headers,
        )

    assert response.status_code == status.HTTP_200_OK
    assert "text/plain" in response.headers["content-type"]
    assert "pdflatex" in response.text


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_get_compile_job_logs_no_logs(mock_publish, client, auth_headers, test_user, db_session):
    """Fetching logs for a job with no logs_ref should return 404."""
    project = _create_project(db_session, test_user.id)
    job = _create_compile_job(db_session, project.id, job_status=JobStatus.PENDING)

    response = client.get(
        f"/api/v1/compile/jobs/{job.id}/logs",
        headers=auth_headers,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "No logs available" in response.json()["detail"]


@patch(
    "app.services.rabbitmq_service.rabbitmq_service.publish_message",
    new_callable=AsyncMock,
)
def test_create_compile_job_includes_files(mock_publish, client, auth_headers, test_user, db_session):
    """Compile job creation should include project file content in the RabbitMQ message."""
    from app.models.models import ProjectFile

    project = _create_project(db_session, test_user.id)

    # Create a file record in the DB
    pf = ProjectFile(
        project_id=project.id,
        path="main.tex",
        blob_ref=f"{project.id}/main.tex",
        size=50,
    )
    db_session.add(pf)
    db_session.commit()

    tex_content = b"\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}"

    with patch("app.api.v1.compile.minio_service") as mock_minio:
        mock_minio._default_bucket = "underleaf-files"
        mock_minio.download_file.return_value = tex_content

        response = client.post(
            "/api/v1/compile/jobs",
            json={"project_id": project.id},
            headers=auth_headers,
        )

    assert response.status_code == status.HTTP_201_CREATED

    # Verify publish was called with file data
    mock_publish.assert_called_once()
    message = mock_publish.call_args[0][1]
    assert len(message["files"]) == 1
    assert message["files"][0]["path"] == "main.tex"
    assert "\\documentclass" in message["files"][0]["content"]
