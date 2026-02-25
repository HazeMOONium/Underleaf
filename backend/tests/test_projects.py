import pytest
from fastapi import status


def test_create_project(client, auth_headers):
    response = client.post(
        "/api/v1/projects",
        json={"title": "Test Project", "visibility": "private"},
        headers=auth_headers
    )
    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert data["title"] == "Test Project"
    assert data["visibility"] == "private"
    assert "id" in data


def test_list_projects(client, auth_headers, test_user, db_session):
    from app.models.models import Project
    project = Project(
        owner_id=test_user.id,
        title="My Project",
        visibility="private"
    )
    db_session.add(project)
    db_session.commit()

    response = client.get("/api/v1/projects", headers=auth_headers)
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_get_project(client, auth_headers, test_user, db_session):
    from app.models.models import Project
    project = Project(
        owner_id=test_user.id,
        title="My Project",
        visibility="private"
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    response = client.get(f"/api/v1/projects/{project.id}", headers=auth_headers)
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["id"] == project.id
    assert data["title"] == "My Project"


def test_delete_project(client, auth_headers, test_user, db_session):
    from app.models.models import Project
    project = Project(
        owner_id=test_user.id,
        title="Project to Delete",
        visibility="private"
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    response = client.delete(f"/api/v1/projects/{project.id}", headers=auth_headers)
    assert response.status_code == status.HTTP_204_NO_CONTENT

    deleted = db_session.query(Project).filter(Project.id == project.id).first()
    assert deleted is None


def test_update_project(client, auth_headers, test_user, db_session):
    """Owner can update the project title via PATCH."""
    from app.models.models import Project

    project = Project(
        owner_id=test_user.id,
        title="Original Title",
        visibility="private",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    response = client.patch(
        f"/api/v1/projects/{project.id}",
        json={"title": "Updated Title"},
        headers=auth_headers,
    )
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["id"] == project.id


def test_update_project_not_owner(client, auth_headers, test_user, db_session):
    """A non-owner should receive 403 when trying to update a project."""
    from app.models.models import Project, User, Permission
    from app.core.security import get_password_hash

    other_user = User(
        email="other@example.com",
        hashed_password=get_password_hash("otherpassword123"),
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)

    project = Project(
        owner_id=other_user.id,
        title="Other's Project",
        visibility="private",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    # Grant test_user viewer permission so they can access but not update
    permission = Permission(
        project_id=project.id,
        user_id=test_user.id,
        role="viewer",
    )
    db_session.add(permission)
    db_session.commit()

    response = client.patch(
        f"/api/v1/projects/{project.id}",
        json={"title": "Hijacked Title"},
        headers=auth_headers,
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["detail"] is not None  # 403 with some detail message


def test_delete_project_not_owner(client, auth_headers, test_user, db_session):
    """A non-owner should receive 403 when trying to delete a project."""
    from app.models.models import Project, User, Permission
    from app.core.security import get_password_hash

    other_user = User(
        email="other2@example.com",
        hashed_password=get_password_hash("otherpassword123"),
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)

    project = Project(
        owner_id=other_user.id,
        title="Other's Project",
        visibility="private",
    )
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)

    # Grant test_user viewer permission so they can access but not delete
    permission = Permission(
        project_id=project.id,
        user_id=test_user.id,
        role="viewer",
    )
    db_session.add(permission)
    db_session.commit()

    response = client.delete(
        f"/api/v1/projects/{project.id}",
        headers=auth_headers,
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["detail"] is not None  # 403 with some detail message


def test_get_project_not_found(client, auth_headers):
    """Requesting a non-existent project should return 404."""
    response = client.get(
        "/api/v1/projects/nonexistent-project-id",
        headers=auth_headers,
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "Project not found" in response.json()["detail"]


def test_unauthenticated_access(client):
    """Accessing projects without authentication should return 401."""
    response = client.get("/api/v1/projects")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED

    response = client.post(
        "/api/v1/projects",
        json={"title": "Unauthorized Project", "visibility": "private"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
