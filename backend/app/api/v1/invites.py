import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.api.v1.projects import get_project_with_access, _role_gte
from app.models.models import Permission, ProjectInvite, ProjectRole, User
from app.schemas.collaboration import (
    InviteCreate,
    InvitePreview,
    InviteResponse,
    MemberResponse,
)

logger = logging.getLogger(__name__)

# Project-scoped invite management — requires owner auth
project_invites_router = APIRouter(prefix="/projects", tags=["invites"])

# Public token routes — no auth required for preview
public_invites_router = APIRouter(prefix="/invites", tags=["invites"])


def _check_invite_validity(invite: ProjectInvite) -> None:
    now = datetime.now(timezone.utc)
    if invite.expires_at and invite.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(status_code=410, detail="Invite link has expired")
    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        raise HTTPException(
            status_code=410, detail="Invite link has reached its maximum uses"
        )


@project_invites_router.post(
    "/{project_id}/invites",
    response_model=InviteResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_invite(
    project_id: str,
    invite_data: InviteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )

    try:
        role = ProjectRole(invite_data.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {invite_data.role}")
    if role == ProjectRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot create owner invite")

    expires_at = None
    if invite_data.expires_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=invite_data.expires_hours)

    invite = ProjectInvite(
        project_id=project_id,
        role=role,
        created_by=current_user.id,
        expires_at=expires_at,
        max_uses=invite_data.max_uses,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    return InviteResponse(
        id=invite.id,
        token=invite.token,
        role=invite.role.value,
        use_count=invite.use_count,
        max_uses=invite.max_uses,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
    )


@project_invites_router.get(
    "/{project_id}/invites", response_model=List[InviteResponse]
)
def list_invites(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    invites = (
        db.query(ProjectInvite)
        .filter(ProjectInvite.project_id == project_id)
        .order_by(ProjectInvite.created_at.desc())
        .all()
    )
    return [
        InviteResponse(
            id=i.id,
            token=i.token,
            role=i.role.value,
            use_count=i.use_count,
            max_uses=i.max_uses,
            expires_at=i.expires_at,
            created_at=i.created_at,
        )
        for i in invites
    ]


@project_invites_router.delete(
    "/{project_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
def revoke_invite(
    project_id: str,
    invite_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    invite = (
        db.query(ProjectInvite)
        .filter(
            ProjectInvite.id == invite_id,
            ProjectInvite.project_id == project_id,
        )
        .first()
    )
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()
    return None


# ── Public routes ────────────────────────────────────────────────────────────

@public_invites_router.get("/{token}", response_model=InvitePreview)
def preview_invite(token: str, db: Session = Depends(get_db)):
    """Returns project name and role — accessible without authentication."""
    invite = db.query(ProjectInvite).filter(ProjectInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    _check_invite_validity(invite)
    project = invite.project
    creator = db.query(User).filter(User.id == invite.created_by).first()
    return InvitePreview(
        project_id=invite.project_id,
        project_title=project.title,
        role=invite.role.value,
        created_by_email=creator.email if creator else "unknown",
    )


@public_invites_router.post("/{token}/accept", response_model=MemberResponse)
def accept_invite(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = db.query(ProjectInvite).filter(ProjectInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    _check_invite_validity(invite)

    project = invite.project
    if project.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="You are already the owner")

    existing = (
        db.query(Permission)
        .filter(
            Permission.project_id == invite.project_id,
            Permission.user_id == current_user.id,
        )
        .first()
    )

    now = datetime.now(timezone.utc)
    if existing:
        # Only upgrade role, never downgrade
        if _role_gte(invite.role, existing.role):
            existing.role = invite.role
    else:
        perm = Permission(
            project_id=invite.project_id,
            user_id=current_user.id,
            role=invite.role,
            granted_by=invite.created_by,
        )
        db.add(perm)

    invite.use_count += 1
    db.commit()

    return MemberResponse(
        user_id=current_user.id,
        email=current_user.email,
        role=invite.role.value,
        granted_at=now,
    )
