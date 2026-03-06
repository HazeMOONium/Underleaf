from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SnapshotResponse(BaseModel):
    id: str
    project_id: str
    compile_job_id: str
    label: Optional[str] = None
    artifact_ref: Optional[str] = None
    created_by: Optional[str] = None
    creator_email: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SnapshotUpdate(BaseModel):
    label: Optional[str] = None
