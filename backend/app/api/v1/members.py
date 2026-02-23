import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.api.v1.projects import get_project_with_access
from app.models.models import Permission, Project, ProjectRole, User
from app.schemas.collaboration import MemberAdd, MemberResponse, MemberUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["members"])


@router.get("/{project_id}/members", response_model=List[MemberResponse])
def list_members(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(project_id, current_user.id, db)

    owner = db.query(User).filter(User.id == project.owner_id).first()
    result: List[MemberResponse] = [
        MemberResponse(
            user_id=owner.id,
            email=owner.email,
            role="owner",
            granted_at=project.created_at,
        )
    ]

    rows = (
        db.query(Permission, User)
        .join(User, User.id == Permission.user_id)
        .filter(Permission.project_id == project_id)
        .all()
    )
    for perm, user in rows:
        result.append(
            MemberResponse(
                user_id=user.id,
                email=user.email,
                role=perm.role.value,
                granted_at=perm.granted_at,
            )
        )
    return result


@router.post(
    "/{project_id}/members",
    response_model=MemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_member(
    project_id: str,
    member_data: MemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )

    try:
        target_role = ProjectRole(member_data.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {member_data.role}")
    if target_role == ProjectRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot assign owner role via API")

    target_user = db.query(User).filter(User.email == member_data.email).first()
    if not target_user:
        raise HTTPException(
            status_code=404,
            detail="User not found — they must register first",
        )
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    if target_user.id == project.owner_id:
        raise HTTPException(status_code=400, detail="User is already the owner")

    existing = (
        db.query(Permission)
        .filter(
            Permission.project_id == project_id,
            Permission.user_id == target_user.id,
        )
        .first()
    )
    now = datetime.now(timezone.utc)
    if existing:
        existing.role = target_role
        existing.granted_by = current_user.id
        existing.granted_at = now
    else:
        perm = Permission(
            project_id=project_id,
            user_id=target_user.id,
            role=target_role,
            granted_by=current_user.id,
        )
        db.add(perm)
    db.commit()

    return MemberResponse(
        user_id=target_user.id,
        email=target_user.email,
        role=target_role.value,
        granted_at=now,
    )


@router.patch("/{project_id}/members/{user_id}", response_model=MemberResponse)
def update_member(
    project_id: str,
    user_id: str,
    update: MemberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    if user_id == project.owner_id:
        raise HTTPException(status_code=400, detail="Cannot change owner's role")

    try:
        new_role = ProjectRole(update.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {update.role}")
    if new_role == ProjectRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot assign owner role")

    perm = (
        db.query(Permission)
        .filter(
            Permission.project_id == project_id,
            Permission.user_id == user_id,
        )
        .first()
    )
    if not perm:
        raise HTTPException(status_code=404, detail="Member not found")
    perm.role = new_role
    db.commit()

    user = db.query(User).filter(User.id == user_id).first()
    return MemberResponse(
        user_id=user.id,
        email=user.email,
        role=new_role.value,
        granted_at=perm.granted_at,
    )


@router.delete(
    "/{project_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_member(
    project_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project, _ = get_project_with_access(
        project_id, current_user.id, db, minimum_role=ProjectRole.OWNER
    )
    if user_id == project.owner_id:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")

    perm = (
        db.query(Permission)
        .filter(
            Permission.project_id == project_id,
            Permission.user_id == user_id,
        )
        .first()
    )
    if not perm:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(perm)
    db.commit()
    return None
