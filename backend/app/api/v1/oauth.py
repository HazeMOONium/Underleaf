"""OAuth 2.0 / SSO routes — Google and GitHub.

Flow:
  1.  GET /auth/oauth/{provider}          → 302 → provider auth page
  2.  GET /auth/oauth/{provider}/callback → exchange code → find/create user
                                          → 302 → FRONTEND_URL/auth/callback?token=…

State (CSRF) tokens are kept in Redis for 10 minutes.
"""

import asyncio
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.v1.auth import _issue_tokens
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, get_password_hash
from app.models.models import User
from app.services.redis_service import redis_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/oauth", tags=["oauth"])
settings = get_settings()

# ── provider config ──────────────────────────────────────────────────────────

_PROVIDERS: dict[str, dict] = {
    "google": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "scope": "openid email profile",
        "client_id_key": "GOOGLE_CLIENT_ID",
        "client_secret_key": "GOOGLE_CLIENT_SECRET",
    },
    "github": {
        "auth_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "scope": "read:user user:email",
        "client_id_key": "GITHUB_CLIENT_ID",
        "client_secret_key": "GITHUB_CLIENT_SECRET",
    },
}


def _provider_cfg(provider: str) -> dict:
    cfg = _PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Unknown OAuth provider: {provider}")
    client_id = getattr(settings, cfg["client_id_key"], "")
    client_secret = getattr(settings, cfg["client_secret_key"], "")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=f"{provider} OAuth is not configured on this server",
        )
    return {**cfg, "client_id": client_id, "client_secret": client_secret}


def _callback_uri(provider: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/api/v1/auth/oauth/{provider}/callback"


# ── redirect to provider ─────────────────────────────────────────────────────

@router.get("/{provider}")
async def oauth_redirect(provider: str):
    cfg = _provider_cfg(provider)
    state = secrets.token_urlsafe(24)
    try:
        await asyncio.wait_for(
            redis_service.set(f"oauth_state:{state}", provider, expire=600),
            timeout=5.0,
        )
    except Exception as exc:
        logger.error("Redis error storing OAuth state: %s", exc)
        raise HTTPException(status_code=503, detail="Service unavailable")

    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": _callback_uri(provider),
        "response_type": "code",
        "scope": cfg["scope"],
        "state": state,
    }
    url = cfg["auth_url"] + "?" + urlencode(params)
    return RedirectResponse(url)


# ── callback ─────────────────────────────────────────────────────────────────

@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    frontend_base = settings.FRONTEND_URL.rstrip("/")

    if error or not code:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=access_denied")

    # Validate state (CSRF)
    try:
        stored_provider = await asyncio.wait_for(
            redis_service.get(f"oauth_state:{state}"), timeout=5.0
        )
    except Exception:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=state_error")

    if stored_provider != provider:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=state_mismatch")

    try:
        await asyncio.wait_for(redis_service.delete(f"oauth_state:{state}"), timeout=5.0)
    except Exception:
        pass

    cfg = _provider_cfg(provider)

    # Exchange code for access token
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            cfg["token_url"],
            data={
                "code": code,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": _callback_uri(provider),
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )

    if token_resp.status_code != 200:
        logger.error("OAuth token exchange failed for %s: %s", provider, token_resp.text)
        return RedirectResponse(f"{frontend_base}/login?oauth_error=token_exchange")

    token_data = token_resp.json()
    access_token_value = token_data.get("access_token")
    if not access_token_value:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=no_token")

    # Fetch user info
    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {"Authorization": f"Bearer {access_token_value}"}
        userinfo_resp = await client.get(cfg["userinfo_url"], headers=headers)

    if userinfo_resp.status_code != 200:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=userinfo_failed")

    userinfo = userinfo_resp.json()

    # Extract email — GitHub requires a separate call for private emails
    email = userinfo.get("email")
    if not email and provider == "github":
        async with httpx.AsyncClient(timeout=15.0) as client:
            emails_resp = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token_value}"},
            )
        if emails_resp.status_code == 200:
            primary = next(
                (e for e in emails_resp.json() if e.get("primary") and e.get("verified")),
                None,
            )
            if primary:
                email = primary["email"]

    if not email:
        return RedirectResponse(f"{frontend_base}/login?oauth_error=no_email")

    provider_id = str(userinfo.get("id") or userinfo.get("sub") or "")

    # Find or create user
    user = (
        db.query(User)
        .filter(User.oauth_provider == provider, User.oauth_provider_id == provider_id)
        .first()
    )

    if user is None:
        # Try to link to an existing account with the same email
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            # Create a new OAuth-only account
            user = User(
                email=email,
                hashed_password=get_password_hash(secrets.token_hex(32)),
                email_verified=True,
                oauth_provider=provider,
                oauth_provider_id=provider_id,
            )
            db.add(user)
        else:
            # Link existing local account to this OAuth provider
            if not user.oauth_provider:
                user.oauth_provider = provider
                user.oauth_provider_id = provider_id
                user.email_verified = True
        db.commit()
        db.refresh(user)

    # Issue tokens — reuse the helper but we can't use the Response object here
    # because we're doing a redirect. Store the access token in Redis briefly
    # so the frontend can pick it up via the /auth/callback page.
    jwt_token = create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token_value = create_refresh_token(subject=user.id)
    try:
        await asyncio.wait_for(
            redis_service.set(
                f"refresh_token:{refresh_token_value}",
                str(user.id),
                expire=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            ),
            timeout=5.0,
        )
    except Exception as exc:
        logger.error("Failed to store refresh token after OAuth login: %s", exc)

    # Redirect to frontend callback page with the short-lived access token in URL
    # (the refresh token is not passed — it will be set by the next /auth/refresh call)
    redirect_url = f"{frontend_base}/auth/callback?token={jwt_token}"
    response = RedirectResponse(redirect_url)
    # Set refresh cookie for the browser
    response.set_cookie(
        key="refresh_token",
        value=refresh_token_value,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth",
    )
    return response
