import secrets
import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, String, DateTime, ForeignKey, Text, Integer, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import relationship
import enum
from app.core.database import Base


class UserRole(str, enum.Enum):
    USER = "user"
    ADMIN = "admin"


class ProjectVisibility(str, enum.Enum):
    PRIVATE = "private"
    PUBLIC = "public"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ProjectRole(str, enum.Enum):
    OWNER = "owner"
    EDITOR = "editor"
    COMMENTER = "commenter"
    VIEWER = "viewer"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.USER, nullable=False)
    # email_verified: False until the user clicks the link in the verification email.
    # Kept separate from the auth flow — unverified users can still log in, but the
    # frontend shows a persistent banner prompting them to verify.
    email_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    projects = relationship("Project", back_populates="owner")
    permissions = relationship("Permission", foreign_keys="Permission.user_id", back_populates="user")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    visibility = Column(SQLEnum(ProjectVisibility), default=ProjectVisibility.PRIVATE, nullable=False)
    settings = Column(Text, default="{}")
    engine = Column(String, default='pdflatex', nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    owner = relationship("User", back_populates="projects")
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    permissions = relationship("Permission", back_populates="project", cascade="all, delete-orphan")
    compile_jobs = relationship("CompileJob", back_populates="project", cascade="all, delete-orphan")
    invites = relationship("ProjectInvite", back_populates="project", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="project", cascade="all, delete-orphan")


class ProjectFile(Base):
    __tablename__ = "project_files"
    __table_args__ = (
        UniqueConstraint("project_id", "path", name="uq_project_file_path"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    path = Column(String, nullable=False)
    blob_ref = Column(String, nullable=True)
    size = Column(Integer, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    project = relationship("Project", back_populates="files")


class Permission(Base):
    __tablename__ = "permissions"

    project_id = Column(String, ForeignKey("projects.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    role = Column(SQLEnum(ProjectRole, values_callable=lambda obj: [e.value for e in obj]), default=ProjectRole.VIEWER, nullable=False)
    granted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    granted_by = Column(String, ForeignKey("users.id"), nullable=True)

    project = relationship("Project", back_populates="permissions")
    user = relationship("User", foreign_keys=[user_id], back_populates="permissions")
    granter = relationship("User", foreign_keys=[granted_by])


class ProjectInvite(Base):
    __tablename__ = "project_invites"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True,
                   default=lambda: secrets.token_urlsafe(32))
    role = Column(SQLEnum(ProjectRole, values_callable=lambda obj: [e.value for e in obj]), nullable=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    use_count = Column(Integer, default=0, nullable=False)
    max_uses = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    project = relationship("Project", back_populates="invites")
    creator = relationship("User", foreign_keys=[created_by])


class Comment(Base):
    __tablename__ = "comments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    file_path = Column(String, nullable=False)
    line = Column(Integer, nullable=False)
    author_id = Column(String, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    parent_id = Column(String, ForeignKey("comments.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])
    replies = relationship(
        "Comment",
        back_populates="parent",
        foreign_keys="Comment.parent_id",
        cascade="all, delete-orphan",
    )
    parent = relationship(
        "Comment",
        back_populates="replies",
        remote_side="Comment.id",
        foreign_keys="Comment.parent_id",
    )


class CompileJob(Base):
    __tablename__ = "compile_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    status = Column(SQLEnum(JobStatus), default=JobStatus.PENDING, nullable=False)
    logs_ref = Column(String, nullable=True)
    artifact_ref = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    finished_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="compile_jobs")
