from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr


# ── Members ─────────────────────────────────────────────────────────────────

class MemberResponse(BaseModel):
    user_id: str
    email: str
    role: str
    granted_at: Optional[datetime] = None


class MemberAdd(BaseModel):
    email: EmailStr
    role: str  # "editor" | "commenter" | "viewer"


class MemberUpdate(BaseModel):
    role: str


# ── Invites ──────────────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    role: str
    max_uses: Optional[int] = None
    expires_hours: Optional[int] = None


class InviteResponse(BaseModel):
    id: str
    token: str
    role: str
    use_count: int
    max_uses: Optional[int]
    expires_at: Optional[datetime]
    created_at: datetime


class InvitePreview(BaseModel):
    project_id: str
    project_title: str
    role: str
    created_by_email: str


# ── Comments ─────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    file_path: str
    line: int
    content: str
    parent_id: Optional[str] = None


class CommentUpdate(BaseModel):
    content: Optional[str] = None
    resolved: Optional[bool] = None


class CommentResponse(BaseModel):
    id: str
    project_id: str
    file_path: str
    line: int
    author_id: str
    author_email: str
    content: str
    parent_id: Optional[str]
    created_at: datetime
    resolved_at: Optional[datetime]
    replies: List[CommentResponse] = []


CommentResponse.model_rebuild()
