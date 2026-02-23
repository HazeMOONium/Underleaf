import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.api.v1.projects import get_project_with_access
from app.models.models import CompileJob, JobStatus, ProjectFile, User
from app.schemas.compile import CompileJobCreate, CompileJobResponse
from app.services.minio_service import minio_service
from app.services.rabbitmq_service import rabbitmq_service, COMPILE_JOBS_QUEUE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compile", tags=["compile"])


@router.post("/jobs", response_model=CompileJobResponse, status_code=status.HTTP_201_CREATED)
async def create_compile_job(
    job_data: CompileJobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project = get_project_with_access(job_data.project_id, current_user.id, db)
    
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
    
    get_project_with_access(job.project_id, current_user.id, db)
    
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
    
    get_project_with_access(job.project_id, current_user.id, db)
    
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

    get_project_with_access(job.project_id, current_user.id, db)

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


@router.get("/jobs/{job_id}/synctex")
def get_job_synctex(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    job = db.query(CompileJob).filter(CompileJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    get_project_with_access(job.project_id, current_user.id, db)

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

    get_project_with_access(job.project_id, current_user.id, db)

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
