import base64
import io
import logging
import zipfile
from typing import List, Optional, Tuple
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.models import Project, ProjectFile, Permission, User, ProjectRole
from app.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectFileBase,
    ProjectFileBinaryUpload,
    ProjectFileResponse,
    ProjectFileRename,
)
from app.services.minio_service import minio_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])

_ROLE_ORDER = {
    ProjectRole.VIEWER: 0,
    ProjectRole.COMMENTER: 1,
    ProjectRole.EDITOR: 2,
    ProjectRole.OWNER: 3,
}


def _role_gte(a: ProjectRole, b: ProjectRole) -> bool:
    return _ROLE_ORDER[a] >= _ROLE_ORDER[b]


def get_project_with_access(
    project_id: str,
    user_id: str,
    db: Session,
    minimum_role: Optional[ProjectRole] = None,
) -> Tuple[Project, ProjectRole]:
    """Return (project, effective_role) or raise 403/404.

    Pass minimum_role to enforce a capability requirement in one call, e.g.::

        project, role = get_project_with_access(
            project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
        )
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.owner_id == user_id:
        effective_role = ProjectRole.OWNER
    else:
        permission = (
            db.query(Permission)
            .filter(
                Permission.project_id == project_id,
                Permission.user_id == user_id,
            )
            .first()
        )
        if not permission:
            raise HTTPException(status_code=403, detail="Access denied")
        effective_role = permission.role

    if minimum_role is not None and not _role_gte(effective_role, minimum_role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    return project, effective_role


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    project_data: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = Project(
        owner_id=current_user.id,
        title=project_data.title,
        visibility=project_data.visibility,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=List[ProjectResponse])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owned = db.query(Project).filter(Project.owner_id == current_user.id).all()
    permissions = db.query(Permission).filter(Permission.user_id == current_user.id).all()
    shared_ids = [p.project_id for p in permissions]
    shared = db.query(Project).filter(Project.id.in_(shared_ids)).all() if shared_ids else []
    return owned + shared


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(project_id, current_user.id, db)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    if project_data.title is not None:
        project.title = project_data.title
    if project_data.visibility is not None:
        project.visibility = project_data.visibility
    if project_data.settings is not None:
        project.settings = project_data.settings
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    db.delete(project)
    db.commit()
    return None


@router.get("/{project_id}/export/zip")
def export_project_zip(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download all project files as a ZIP archive."""
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.VIEWER
    )

    files = db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()
    bucket = minio_service._default_bucket

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in files:
            if not file.blob_ref:
                file_bytes = b""
            else:
                try:
                    file_bytes = minio_service.download_file(bucket, file.blob_ref)
                except Exception as e:
                    logger.warning(f"Skipping file {file.path} during ZIP export: {e}")
                    file_bytes = b""
            zf.writestr(file.path, file_bytes)

    zip_buffer.seek(0)

    safe_title = quote(project.title, safe="")
    filename_header = f"attachment; filename*=UTF-8''{safe_title}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": filename_header},
    )


@router.get("/{project_id}/files", response_model=List[ProjectFileResponse])
def list_files(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db)
    files = db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()
    return files


@router.post(
    "/{project_id}/files",
    response_model=ProjectFileResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_file(
    project_id: str,
    file_data: ProjectFileBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
    )

    existing = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == file_data.path,
        )
        .first()
    )

    bucket = minio_service._default_bucket

    try:
        blob_ref = f"{project_id}/{file_data.path}"
        content = file_data.content or ""
        minio_service.upload_file(bucket, blob_ref, content.encode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")

    if existing:
        if existing.blob_ref and existing.blob_ref != blob_ref:
            try:
                minio_service.delete_file(bucket, existing.blob_ref)
            except Exception as e:
                logger.warning(f"Failed to delete old blob {existing.blob_ref}: {e}")
        existing.blob_ref = blob_ref
        existing.size = len(content)
        db.commit()
        db.refresh(existing)
        return existing

    file = ProjectFile(
        project_id=project_id,
        path=file_data.path,
        blob_ref=blob_ref,
        size=len(content),
    )
    db.add(file)
    db.commit()
    db.refresh(file)
    return file


@router.post(
    "/{project_id}/files/upload",
    response_model=ProjectFileResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_binary_file(
    project_id: str,
    upload_data: ProjectFileBinaryUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a binary file (base64-encoded) to the project."""
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
    )

    try:
        file_bytes = base64.b64decode(upload_data.content_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 content")

    bucket = minio_service._default_bucket
    blob_ref = f"{project_id}/{upload_data.path}"

    try:
        minio_service.upload_file(bucket, blob_ref, file_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")

    existing = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == upload_data.path,
        )
        .first()
    )

    if existing:
        existing.blob_ref = blob_ref
        existing.size = len(file_bytes)
        db.commit()
        db.refresh(existing)
        return existing

    file = ProjectFile(
        project_id=project_id,
        path=upload_data.path,
        blob_ref=blob_ref,
        size=len(file_bytes),
    )
    db.add(file)
    db.commit()
    db.refresh(file)
    return file


@router.get("/{project_id}/files/{file_path:path}")
def get_file(
    project_id: str,
    file_path: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db)
    file = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == file_path,
        )
        .first()
    )

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if not file.blob_ref:
        return Response(content="", media_type="text/plain")

    try:
        bucket = minio_service._default_bucket
        content = minio_service.download_file(bucket, file.blob_ref)
        return Response(content=content.decode("utf-8"), media_type="text/plain")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch file: {str(e)}")


@router.patch(
    "/{project_id}/files/{file_path:path}", response_model=ProjectFileResponse
)
def rename_file(
    project_id: str,
    file_path: str,
    rename_data: ProjectFileRename,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
    )

    file = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == file_path,
        )
        .first()
    )

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    new_path = rename_data.new_path.strip()
    if not new_path:
        raise HTTPException(status_code=400, detail="New path cannot be empty")

    conflict = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == new_path,
        )
        .first()
    )
    if conflict:
        raise HTTPException(
            status_code=409, detail="A file already exists at the target path"
        )

    bucket = minio_service._default_bucket
    new_blob_ref = f"{project_id}/{new_path}"

    if file.blob_ref:
        try:
            content = minio_service.download_file(bucket, file.blob_ref)
            minio_service.upload_file(bucket, new_blob_ref, content)
            minio_service.delete_file(bucket, file.blob_ref)
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to rename file in storage: {str(e)}"
            )

    file.path = new_path
    file.blob_ref = new_blob_ref
    db.commit()
    db.refresh(file)
    return file


@router.delete(
    "/{project_id}/files/{file_path:path}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_file(
    project_id: str,
    file_path: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
    )
    file = (
        db.query(ProjectFile)
        .filter(
            ProjectFile.project_id == project_id,
            ProjectFile.path == file_path,
        )
        .first()
    )

    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if file.blob_ref:
        try:
            bucket = minio_service._default_bucket
            minio_service.delete_file(bucket, file.blob_ref)
        except Exception as e:
            logger.warning(f"Failed to delete blob {file.blob_ref}: {e}")

    db.delete(file)
    db.commit()
    return None
