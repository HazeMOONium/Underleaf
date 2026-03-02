from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class CompileJobCreate(BaseModel):
    project_id: str
    draft: Optional[bool] = False


class CompileJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    status: str
    logs_ref: Optional[str] = None
    artifact_ref: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None


class CompileJobStatus(BaseModel):
    id: str
    status: str
    error_message: Optional[str] = None
    finished_at: Optional[datetime] = None
