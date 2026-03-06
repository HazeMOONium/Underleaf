import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.api.v1.projects import get_project_with_access
from app.models.models import CompileJob, JobStatus, ProjectFile, ProjectRole, Snapshot, User
from app.schemas.compile import CompileJobCreate, CompileJobResponse
from app.schemas.snapshot import SnapshotResponse, SnapshotUpdate
from app.services.minio_service import minio_service
from app.services.rabbitmq_service import rabbitmq_service, COMPILE_JOBS_QUEUE
from app.services.redis_service import redis_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compile", tags=["compile"])


@router.post("/jobs", response_model=CompileJobResponse, status_code=status.HTTP_201_CREATED)
async def create_compile_job(
    job_data: CompileJobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project, _ = get_project_with_access(
        job_data.project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR
    )

    job = CompileJob(
        project_id=project.id,
        status=JobStatus.PENDING
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    
    # Fetch project files and their content for the worker
    files_data = []
    project_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project.id
    ).all()

    bucket = minio_service._default_bucket
    for pf in project_files:
        file_entry = {"path": pf.path, "content": ""}
        if pf.blob_ref:
            try:
                content_bytes = minio_service.download_file(bucket, pf.blob_ref)
                file_entry["content"] = content_bytes.decode("utf-8")
            except Exception as e:
                logger.warning(f"Failed to fetch file {pf.path} for compile: {e}")
        files_data.append(file_entry)

    try:
        await rabbitmq_service.publish_message(
            COMPILE_JOBS_QUEUE,
            {
                "job_id": job.id,
                "project_id": job.project_id,
                "files": files_data,
                "engine": project.engine or "pdflatex",
                "draft": job_data.draft or False,
            }
        )
    except ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to queue compile job"
        )

    return job


@router.get("/jobs/{job_id}", response_model=CompileJobResponse)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]
    
    return job


@router.get("/jobs/{job_id}/status")
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]

    # Auto-create a Snapshot the first time we see a completed job with an artifact.
    # The unique constraint on compile_job_id makes this idempotent.
    # Hash-based dedup: skip if the PDF is identical to the last snapshot's.
    if job.status == JobStatus.COMPLETED and job.artifact_ref:
        exists = db.query(Snapshot).filter(Snapshot.compile_job_id == job.id).first()
        if not exists:
            # Check if artifact hash matches the most recent snapshot
            skip = False
            if job.artifact_hash:
                last_snap = (
                    db.query(Snapshot)
                    .filter(Snapshot.project_id == job.project_id)
                    .order_by(Snapshot.created_at.desc())
                    .first()
                )
                if last_snap and last_snap.compile_job and last_snap.compile_job.artifact_hash == job.artifact_hash:
                    skip = True
            if not skip:
                snapshot = Snapshot(
                    project_id=job.project_id,
                    compile_job_id=job.id,
                    created_by=current_user.id,
                )
                db.add(snapshot)
                try:
                    db.commit()
                except Exception:
                    db.rollback()

    return {
        "id": job.id,
        "status": job.status.value,
        "error_message": job.error_message,
        "finished_at": job.finished_at
    }


@router.get("/jobs/{job_id}/artifact")
def get_job_artifact(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]

    if not job.artifact_ref:
        raise HTTPException(status_code=404, detail="No artifact available")

    try:
        bucket = minio_service._default_bucket
        pdf_bytes = minio_service.download_file(bucket, job.artifact_ref)
        from io import BytesIO
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename=output.pdf"}
        )
    except Exception as e:
        logger.error(f"Failed to download artifact for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve artifact")


@router.get("/jobs/{job_id}/artifact-url")
async def get_job_artifact_url(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a presigned MinIO URL for the job's PDF artifact.

    Only available when ``MINIO_PUBLIC_URL`` is configured. The URL is cached
    in Redis for ~14 minutes so repeated calls (e.g. page reload) don't
    re-sign the same object.
    """
    settings = get_settings()
    if not settings.MINIO_PUBLIC_URL:
        raise HTTPException(
            status_code=404,
            detail="Presigned URLs not configured (MINIO_PUBLIC_URL not set)",
        )

    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]

    if not job.artifact_ref:
        raise HTTPException(status_code=404, detail="No artifact available")

    bucket = minio_service._default_bucket
    url = await minio_service.get_presigned_url_cached(bucket, job.artifact_ref, redis_service)
    return {"url": url}


@router.get("/jobs/{job_id}/synctex")
def get_job_synctex(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]

    synctex_ref = f"artifacts/{job_id}/output.synctex.gz"
    try:
        bucket = minio_service._default_bucket
        synctex_bytes = minio_service.download_file(bucket, synctex_ref)
        from io import BytesIO
        from fastapi.responses import Response
        return Response(
            content=synctex_bytes,
            media_type="application/gzip",
            headers={"Content-Disposition": "inline; filename=output.synctex.gz"},
        )
    except Exception as e:
        logger.warning(f"SyncTeX not available for job {job_id}: {e}")
        raise HTTPException(status_code=404, detail="SyncTeX data not available")


@router.get("/jobs/{job_id}/logs")
def get_job_logs(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)  # type: ignore[misc]

    if not job.logs_ref:
        raise HTTPException(status_code=404, detail="No logs available")

    try:
        bucket = minio_service._default_bucket
        log_bytes = minio_service.download_file(bucket, job.logs_ref)
        from fastapi.responses import Response
        return Response(content=log_bytes.decode("utf-8"), media_type="text/plain")
    except Exception as e:
        logger.error(f"Failed to download logs for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve logs")


# ── Snapshots router ──────────────────────────────────────────────────────────
# Mounted at /projects/{project_id}/snapshots in main.py

snapshots_router = APIRouter(prefix="/projects", tags=["snapshots"])


def _snapshot_to_response(snap: Snapshot) -> dict:
    return {
        "id": snap.id,
        "project_id": snap.project_id,
        "compile_job_id": snap.compile_job_id,
        "label": snap.label,
        "artifact_ref": snap.compile_job.artifact_ref if snap.compile_job else None,
        "created_by": snap.created_by,
        "creator_email": snap.creator.email if snap.creator else None,
        "created_at": snap.created_at,
    }


@snapshots_router.get("/{project_id}/snapshots", response_model=list[SnapshotResponse])
def list_snapshots(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db)  # type: ignore[misc]
    snaps = (
        db.query(Snapshot)
        .filter(Snapshot.project_id == project_id)
        .order_by(Snapshot.created_at.desc())
        .all()
    )
    return [_snapshot_to_response(s) for s in snaps]


@snapshots_router.get("/{project_id}/snapshots/{snapshot_id}/artifact")
def get_snapshot_artifact(
    project_id: str,
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db)  # type: ignore[misc]
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id, Snapshot.project_id == project_id
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    artifact_ref = snap.compile_job.artifact_ref if snap.compile_job else None
    if not artifact_ref:
        raise HTTPException(status_code=404, detail="No artifact for this snapshot")
    try:
        from io import BytesIO
        bucket = minio_service._default_bucket
        pdf_bytes = minio_service.download_file(bucket, artifact_ref)
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=snapshot.pdf"},
        )
    except Exception as e:
        logger.error(f"Failed to download snapshot artifact {snapshot_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve artifact")


@snapshots_router.patch("/{project_id}/snapshots/{snapshot_id}", response_model=SnapshotResponse)
def update_snapshot(
    project_id: str,
    snapshot_id: str,
    patch: SnapshotUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR)  # type: ignore[misc]
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id, Snapshot.project_id == project_id
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if patch.label is not None:
        snap.label = patch.label
    db.commit()
    db.refresh(snap)
    return _snapshot_to_response(snap)


@snapshots_router.get("/{project_id}/snapshots/{snapshot_id}/source")
def get_snapshot_source(
    project_id: str,
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the list of source files captured at this snapshot's compile time."""
    get_project_with_access(project_id, current_user.id, db)  # type: ignore[misc]
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id, Snapshot.project_id == project_id
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    source_ref = f"artifacts/{snap.compile_job_id}/source.json"
    try:
        bucket = minio_service._default_bucket
        raw = minio_service.download_file(bucket, source_ref)
        files_data: list[dict] = json.loads(raw)
    except Exception as e:
        logger.warning(f"Source not available for snapshot {snapshot_id}: {e}")
        raise HTTPException(
            status_code=404,
            detail="Source snapshot not available. Only snapshots created after this feature was added can be browsed.",
        )

    return {"files": files_data}


@snapshots_router.post("/{project_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(
    project_id: str,
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restore all project files to the state captured when this snapshot was created."""
    get_project_with_access(project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR)  # type: ignore[misc]
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id, Snapshot.project_id == project_id
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    source_ref = f"artifacts/{snap.compile_job_id}/source.json"
    try:
        bucket = minio_service._default_bucket
        raw = minio_service.download_file(bucket, source_ref)
        files_data: list[dict] = json.loads(raw)
    except Exception as e:
        logger.warning(f"Source snapshot not available for {snapshot_id}: {e}")
        raise HTTPException(
            status_code=404,
            detail="Source snapshot not available for this entry. Only snapshots created after this feature was added can be restored.",
        )

    # Build a map of current files for this project
    existing = {
        pf.path: pf
        for pf in db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()
    }
    snapshot_paths = {f["path"] for f in files_data}

    for file_data in files_data:
        path = file_data["path"]
        content = file_data.get("content", "")
        blob_ref = f"projects/{project_id}/{uuid4()}"
        minio_service.upload_file(bucket, blob_ref, content.encode("utf-8"))

        if path in existing:
            existing[path].blob_ref = blob_ref
        else:
            db.add(ProjectFile(project_id=project_id, path=path, blob_ref=blob_ref))

    # Delete files that existed in the project but not in the snapshot
    for path, pf in existing.items():
        if path not in snapshot_paths:
            db.delete(pf)

    db.commit()
    return {"restored": True, "file_count": len(files_data)}


@snapshots_router.delete("/{project_id}/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(
    project_id: str,
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db, minimum_role=ProjectRole.EDITOR)  # type: ignore[misc]
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id, Snapshot.project_id == project_id
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snap)
    db.commit()
