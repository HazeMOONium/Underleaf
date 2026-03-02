import asyncio
import logging
import secrets

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import Optional

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from app.core.config import get_settings
from app.models.models import User
from app.models.models import TotpBackupCode
from app.schemas.user import (
    UserCreate,
    UserResponse,
    Token,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ChangePasswordRequest,
    VerifyEmailRequest,
    TotpEnableResponse,
    TotpVerifyRequest,
    TotpVerifyResponse,
    TotpDisableRequest,
    TotpLoginRequest,
    LoginResponse,
)
from app.services.redis_service import redis_service
from app.services.email_service import send_password_reset_email, send_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


@router.post("/register", response_model=UserResponse)
async def register(
    user_data: UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = User(
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        # email_verified defaults to False — set True only after token redemption
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Generate a single-use verification token stored in Redis for 24 hours.
    # Using secrets.token_urlsafe(32) gives 256 bits of entropy — safe against
    # brute-force enumeration even without rate limiting on the verify endpoint.
    verify_token = secrets.token_urlsafe(32)
    redis_key = f"email_verify:{verify_token}"
    try:
        await asyncio.wait_for(
            redis_service.set(redis_key, str(user.id), expire=86400),  # 24 h
            timeout=5.0,
        )
    except Exception as exc:
        # Non-fatal: user can request a new link; registration still succeeds.
        logger.error("Failed to store email verification token in Redis: %s", exc)
    else:
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verify_token}"
        background_tasks.add_task(send_verification_email, user.email, verify_url)

    return user


@router.post("/verify-email")
async def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Redeem a single-use email verification token.

    The token is deleted from Redis immediately on success so it cannot be
    reused. Expiry is handled automatically by Redis TTL.
    """
    redis_key = f"email_verify:{body.token}"

    try:
        user_id = await asyncio.wait_for(redis_service.get(redis_key), timeout=5.0)
    except Exception as exc:
        logger.error("Redis error during email verification: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    user.email_verified = True
    db.commit()

    # Delete the token so it cannot be replayed — Redis TTL alone is not enough
    # since we want immediate invalidation after first use.
    try:
        await asyncio.wait_for(redis_service.delete(redis_key), timeout=5.0)
    except Exception:
        pass  # TTL will expire the key anyway

    return {"detail": "Email verified successfully"}


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth",
    )


async def _issue_tokens(response: Response, user_id: str) -> LoginResponse:
    """Create an access + refresh token pair and set the refresh cookie."""
    access_token = create_access_token(
        subject=user_id,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token_value = create_refresh_token(subject=user_id)
    try:
        await asyncio.wait_for(
            redis_service.set(
                f"refresh_token:{refresh_token_value}",
                str(user_id),
                expire=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            ),
            timeout=5.0,
        )
    except Exception as exc:
        logger.error("Failed to store refresh token in Redis: %s", exc)
    _set_refresh_cookie(response, refresh_token_value)
    return LoginResponse(access_token=access_token)


@router.post("/login", response_model=LoginResponse)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # If 2FA is enabled, return a short-lived session token — no access token yet
    if user.totp_enabled:
        session_token = secrets.token_urlsafe(32)
        try:
            await asyncio.wait_for(
                redis_service.set(f"2fa_session:{session_token}", str(user.id), expire=300),
                timeout=5.0,
            )
        except Exception as exc:
            logger.error("Failed to store 2FA session token: %s", exc)
            raise HTTPException(status_code=503, detail="Service unavailable")
        return LoginResponse(requires_2fa=True, session_token=session_token)

    return await _issue_tokens(response, user.id)


@router.post("/refresh", response_model=Token)
async def refresh_access_token(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """Issue a new short-lived access token using the refresh token cookie.

    On success the old refresh token is revoked (rotation) and a new one is
    set so the rolling 30-day window restarts.
    """
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    user_id = decode_refresh_token(refresh_token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    # Verify the token is still in Redis (not revoked)
    redis_key = f"refresh_token:{refresh_token}"
    try:
        stored_user_id = await asyncio.wait_for(redis_service.get(redis_key), timeout=5.0)
    except Exception as exc:
        logger.error("Redis error during token refresh: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Service unavailable")

    if not stored_user_id or stored_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Rotate: delete old token, issue new ones
    try:
        await asyncio.wait_for(redis_service.delete(redis_key), timeout=5.0)
    except Exception:
        pass

    new_access_token = create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    new_refresh_token = create_refresh_token(subject=user.id)

    try:
        await asyncio.wait_for(
            redis_service.set(
                f"refresh_token:{new_refresh_token}",
                str(user.id),
                expire=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            ),
            timeout=5.0,
        )
    except Exception as exc:
        logger.error("Failed to store rotated refresh token: %s", exc)

    _set_refresh_cookie(response, new_refresh_token)
    return {"access_token": new_access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None),
):
    """Revoke the refresh token and clear the cookie."""
    if refresh_token:
        try:
            await asyncio.wait_for(
                redis_service.delete(f"refresh_token:{refresh_token}"),
                timeout=5.0,
            )
        except Exception:
            pass

    response.delete_cookie(key="refresh_token", path="/api/v1/auth")
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me/password")
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    return {"detail": "Password changed successfully"}


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    _SAFE_RESPONSE = {"detail": "If that email is registered, a reset link has been sent."}

    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        return _SAFE_RESPONSE

    token = secrets.token_urlsafe(32)
    redis_key = f"pwd_reset:{token}"
    expire_seconds = settings.PASSWORD_RESET_EXPIRE_MINUTES * 60

    try:
        await asyncio.wait_for(
            redis_service.set(redis_key, str(user.id), expire=expire_seconds),
            timeout=5.0,
        )
    except Exception as exc:
        logger.error("Failed to store password reset token in Redis: %s", exc)
        return _SAFE_RESPONSE

    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    background_tasks.add_task(send_password_reset_email, user.email, reset_url)

    return _SAFE_RESPONSE


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    redis_key = f"pwd_reset:{body.token}"

    try:
        user_id = await asyncio.wait_for(redis_service.get(redis_key), timeout=5.0)
    except Exception as exc:
        logger.error("Redis error during password reset: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user.hashed_password = get_password_hash(body.new_password)
    db.commit()

    try:
        await asyncio.wait_for(redis_service.delete(redis_key), timeout=5.0)
    except Exception:
        pass  # token expiry handles cleanup

    return {"detail": "Password updated successfully"}


# ── Two-Factor Authentication (TOTP) ────────────────────────────────────────

@router.post("/2fa/enable", response_model=TotpEnableResponse)
def totp_enable(current_user: User = Depends(get_current_user)):
    """Generate a new TOTP secret and return the otpauth:// URI for QR rendering.

    The secret is NOT yet stored — the client must call /2fa/verify to confirm
    they can produce a valid code before 2FA is activated.
    """
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=current_user.email, issuer_name="Underleaf")
    return TotpEnableResponse(totp_secret=secret, provisioning_uri=uri)


@router.post("/2fa/verify", response_model=TotpVerifyResponse)
def totp_verify(
    body: TotpVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Confirm 2FA setup: verify the first code, store secret, generate backup codes."""
    import pyotp
    totp = pyotp.TOTP(body.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid TOTP code")

    # Delete existing backup codes (idempotent re-enable)
    db.query(TotpBackupCode).filter(TotpBackupCode.user_id == current_user.id).delete()

    # Generate 10 one-time backup codes
    raw_codes = [secrets.token_hex(4).upper() for _ in range(10)]  # 8-char hex
    for raw in raw_codes:
        db.add(TotpBackupCode(user_id=current_user.id, code_hash=get_password_hash(raw)))

    current_user.totp_secret = body.totp_secret
    current_user.totp_enabled = True
    db.commit()

    return TotpVerifyResponse(backup_codes=raw_codes)


@router.post("/2fa/disable")
def totp_disable(
    body: TotpDisableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disable 2FA after confirming the user's password."""
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    db.query(TotpBackupCode).filter(TotpBackupCode.user_id == current_user.id).delete()
    db.commit()
    return {"detail": "Two-factor authentication disabled"}


@router.post("/2fa/login", response_model=LoginResponse)
async def totp_login(
    response: Response,
    body: TotpLoginRequest,
    db: Session = Depends(get_db),
):
    """Second-step: exchange a 2FA session token + TOTP code for full access token."""
    import pyotp

    # Look up the pending session
    redis_key = f"2fa_session:{body.session_token}"
    try:
        user_id = await asyncio.wait_for(redis_service.get(redis_key), timeout=5.0)
    except Exception as exc:
        logger.error("Redis error during 2FA login: %s", exc)
        raise HTTPException(status_code=503, detail="Service unavailable")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=401, detail="2FA not configured")

    # Verify 6-digit TOTP code
    totp = pyotp.TOTP(user.totp_secret)
    code_valid = totp.verify(body.code, valid_window=1)

    if not code_valid:
        # Try backup codes
        backup = (
            db.query(TotpBackupCode)
            .filter(TotpBackupCode.user_id == user.id, TotpBackupCode.used == False)  # noqa: E712
            .all()
        )
        matched = next((bc for bc in backup if verify_password(body.code.upper(), bc.code_hash)), None)
        if not matched:
            raise HTTPException(status_code=401, detail="Invalid authentication code")
        matched.used = True
        db.commit()

    # Consume the session token
    try:
        await asyncio.wait_for(redis_service.delete(redis_key), timeout=5.0)
    except Exception:
        pass

    return await _issue_tokens(response, user.id)
