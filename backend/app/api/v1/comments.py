import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.api.v1.projects import get_project_with_access, _role_gte
from app.models.models import Comment, ProjectRole, User
from app.schemas.collaboration import CommentCreate, CommentResponse, CommentUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["comments"])


def _build_response(comment: Comment, author: User, db: Session) -> CommentResponse:
    reply_rows = (
        db.query(Comment, User)
        .join(User, User.id == Comment.author_id)
        .filter(Comment.parent_id == comment.id)
        .order_by(Comment.created_at)
        .all()
    )
    return CommentResponse(
        id=comment.id,
        project_id=comment.project_id,
        file_path=comment.file_path,
        line=comment.line,
        author_id=comment.author_id,
        author_email=author.email,
        content=comment.content,
        parent_id=comment.parent_id,
        created_at=comment.created_at,
        resolved_at=comment.resolved_at,
        replies=[_build_response(r, a, db) for r, a in reply_rows],
    )


@router.get("/{project_id}/comments", response_model=List[CommentResponse])
def list_comments(
    project_id: str,
    file_path: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_project_with_access(project_id, current_user.id, db)

    q = (
        db.query(Comment, User)
        .join(User, User.id == Comment.author_id)
        .filter(
            Comment.project_id == project_id,
            Comment.parent_id.is_(None),
        )
    )
    if file_path:
        q = q.filter(Comment.file_path == file_path)

    rows = q.order_by(Comment.line, Comment.created_at).all()
    return [_build_response(c, a, db) for c, a in rows]


@router.post(
    "/{project_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    project_id: str,
    comment_data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, role = get_project_with_access(project_id, current_user.id, db)
    if not _role_gte(role, ProjectRole.COMMENTER):
        raise HTTPException(status_code=403, detail="Viewers cannot post comments")

    if comment_data.parent_id:
        parent = (
            db.query(Comment)
            .filter(
                Comment.id == comment_data.parent_id,
                Comment.project_id == project_id,
            )
            .first()
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent.parent_id is not None:
            raise HTTPException(
                status_code=400, detail="Cannot nest replies more than one level deep"
            )

    comment = Comment(
        project_id=project_id,
        file_path=comment_data.file_path,
        line=comment_data.line,
        author_id=current_user.id,
        content=comment_data.content,
        parent_id=comment_data.parent_id,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return CommentResponse(
        id=comment.id,
        project_id=comment.project_id,
        file_path=comment.file_path,
        line=comment.line,
        author_id=comment.author_id,
        author_email=current_user.email,
        content=comment.content,
        parent_id=comment.parent_id,
        created_at=comment.created_at,
        resolved_at=comment.resolved_at,
        replies=[],
    )


@router.patch("/{project_id}/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    project_id: str,
    comment_id: str,
    update: CommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, role = get_project_with_access(project_id, current_user.id, db)

    comment = (
        db.query(Comment)
        .filter(Comment.id == comment_id, Comment.project_id == project_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if update.content is not None:
        if comment.author_id != current_user.id:
            raise HTTPException(status_code=403, detail="Can only edit your own comments")
        comment.content = update.content

    if update.resolved is not None:
        is_privileged = role in (ProjectRole.OWNER, ProjectRole.EDITOR)
        if not is_privileged and comment.author_id != current_user.id:
            raise HTTPException(
                status_code=403, detail="Insufficient permissions to resolve comment"
            )
        comment.resolved_at = datetime.now(timezone.utc) if update.resolved else None

    db.commit()
    db.refresh(comment)
    author = db.query(User).filter(User.id == comment.author_id).first()
    return _build_response(comment, author, db)


@router.delete(
    "/{project_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_comment(
    project_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, role = get_project_with_access(project_id, current_user.id, db)

    comment = (
        db.query(Comment)
        .filter(Comment.id == comment_id, Comment.project_id == project_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment.author_id != current_user.id and role != ProjectRole.OWNER:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    db.delete(comment)
    db.commit()
    return None
