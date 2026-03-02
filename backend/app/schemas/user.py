from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    email_verified: bool
    totp_enabled: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    user_id: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class VerifyEmailRequest(BaseModel):
    token: str


# ── 2FA / TOTP schemas ──────────────────────────────────────────────────────

class TotpEnableResponse(BaseModel):
    """Returned by POST /auth/2fa/enable — contains the secret and QR URI."""
    totp_secret: str
    provisioning_uri: str  # otpauth:// URI for QR code rendering


class TotpVerifyRequest(BaseModel):
    """Confirm 2FA setup by submitting the first TOTP code."""
    totp_secret: str
    code: str


class TotpVerifyResponse(BaseModel):
    """Returned when 2FA is successfully enabled; includes backup codes."""
    backup_codes: list[str]


class TotpDisableRequest(BaseModel):
    """Disable 2FA; requires current password for confirmation."""
    password: str


class TotpLoginRequest(BaseModel):
    """Second-step 2FA login after password is verified."""
    session_token: str
    code: str  # 6-digit TOTP code or 8-char backup code


class LoginResponse(BaseModel):
    """Extended login response that also surfaces 2FA status."""
    access_token: Optional[str] = None
    token_type: str = "bearer"
    requires_2fa: bool = False
    session_token: Optional[str] = None
