from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class ProjectBase(BaseModel):
    title: str
    visibility: str = "private"


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    visibility: Optional[str] = None
    settings: Optional[str] = None


class ProjectResponse(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_id: str
    settings: str
    created_at: datetime
    updated_at: datetime


class ProjectFileBase(BaseModel):
    path: str
    content: Optional[str] = None


class ProjectFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    path: str
    blob_ref: Optional[str]
    size: int
    updated_at: datetime


class ProjectFileRename(BaseModel):
    new_path: str


class ProjectFileBinaryUpload(BaseModel):
    path: str
    content_base64: str


class FileTreeNode(BaseModel):
    name: str
    path: str
    type: str
    children: List["FileTreeNode"] = []
