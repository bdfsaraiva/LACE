"""
Authentication endpoints: login, token refresh, and current-user lookup.

All endpoints in this module live under the ``/auth`` URL prefix.  The module
applies a shared ``RateLimiter`` instance to the token and refresh endpoints to
limit brute-force attempts on the credential flow.

There is no self-registration: user accounts are created by an admin through
``POST /admin/users``.

Endpoints:
- ``POST /auth/token``   — exchange username/password for access + refresh tokens
- ``POST /auth/refresh`` — exchange a refresh token for a new token pair
- ``GET  /auth/me``      — return the authenticated user's profile
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from calendar import timegm
from datetime import datetime, timedelta

from ..database import get_db
from ..models import User
from ..schemas import Token, User as UserSchema, RefreshTokenRequest
from ..auth import (
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    refresh_access_token,
)
from ..config import get_settings
from ..utils.rate_limit import RateLimiter, enforce_rate_limit

settings = get_settings()
router = APIRouter()

# Rate limiter shared by the login and refresh endpoints.  The window and
# request-count thresholds come from the application settings so they can be
# adjusted per environment without code changes.
auth_rate_limiter = RateLimiter(
    settings.AUTH_RATE_LIMIT_REQUESTS,
    settings.AUTH_RATE_LIMIT_WINDOW_SECONDS
)


class TokenResponse(Token):
    """
    Extended OAuth2 token response that adds a refresh token and expiry hint.

    Inherits ``access_token`` and ``token_type`` from the base ``Token`` schema.
    """

    refresh_token: str
    """Token that can be exchanged for a new access token until the session ends."""
    expires_in: int
    """Access-token lifetime expressed in **seconds** (for client convenience)."""
    session_expires_at: int
    """Session end as a Unix timestamp (seconds); the refresh token expires then."""


def _issue_tokens(username: str, session_expires_at: datetime) -> TokenResponse:
    """
    Build an access/refresh token pair bounded by the session end.

    The refresh token expires exactly at ``session_expires_at``; the access
    token lives ``ACCESS_TOKEN_EXPIRE_MINUTES`` but never past the session end,
    so no token outlives the session.

    Args:
        username: Subject (``sub``) of both tokens.
        session_expires_at: Naive UTC datetime at which the session ends.

    Returns:
        The ``TokenResponse`` to send to the client.
    """
    # Whole seconds, like the JWT "exp" claim, so the refresh token's expiry
    # equals session_expires_at despite the microseconds between utcnow() calls.
    session_expires_at = session_expires_at.replace(microsecond=0)
    now = datetime.utcnow()
    access_expires_at = min(
        now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        session_expires_at
    )
    access_token = create_access_token(
        data={"sub": username},
        expires_delta=access_expires_at - now
    )
    refresh_token = create_refresh_token(
        data={"sub": username},
        expires_delta=session_expires_at - now
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=int((access_expires_at - now).total_seconds()),
        # Same conversion python-jose uses for "exp", so this equals the
        # refresh token's expiry claim.
        session_expires_at=timegm(session_expires_at.utctimetuple())
    )


@router.post("/token", response_model=TokenResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
) -> TokenResponse:
    """
    Exchange username and password credentials for an access/refresh token pair.

    The endpoint is rate-limited to prevent brute-force attacks.  A deliberate
    generic error message ("Incorrect username or password") is returned whether
    the username does not exist or the password is wrong, to avoid user
    enumeration.

    Args:
        request: The raw HTTP request, used to extract the client IP for rate
            limiting.
        form_data: Standard OAuth2 password grant body (``username`` +
            ``password`` form fields).
        db: Database session injected by FastAPI.

    Returns:
        A ``TokenResponse`` with a short-lived access token, a refresh token
        valid until the session ends (``SESSION_EXPIRE_MINUTES`` from now), the
        access-token expiry in seconds, and the session end.

    Raises:
        HTTPException: 429 if the rate limit is exceeded.
        HTTPException: 401 if the credentials are invalid.
    """
    enforce_rate_limit(request, auth_rate_limiter, scope="auth")

    user = db.query(User).filter(User.username == form_data.username).first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session_expires_at = datetime.utcnow() + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
    return _issue_tokens(user.username, session_expires_at)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db)
) -> TokenResponse:
    """
    Exchange a valid refresh token for a new access/refresh token pair.

    The refresh token is validated (signature, expiry, and ``"type":"refresh"``
    claim) by the ``refresh_access_token`` helper before new tokens are issued.
    Both old tokens are discarded; the client should store the newly returned
    pair.

    Sessions have an absolute lifetime: a routine refresh (access token
    expired) keeps the current session end, and only ``extend_session=true``
    (the user's explicit "Renew session") moves it to now +
    ``SESSION_EXPIRE_MINUTES``.  Once the session has ended the refresh token is
    expired, so neither kind of refresh is possible.

    Args:
        request: Raw HTTP request used for rate limiting.
        payload: JSON body with the ``refresh_token`` string and the
            ``extend_session`` flag.
        db: Database session injected by FastAPI.

    Returns:
        A new ``TokenResponse`` with fresh access and refresh tokens.

    Raises:
        HTTPException: 429 if the rate limit is exceeded.
        HTTPException: 401 if the refresh token is invalid, expired, or of the
            wrong type.
    """
    enforce_rate_limit(request, auth_rate_limiter, scope="auth")
    token_data = await refresh_access_token(refresh_token=payload.refresh_token, db=db)

    renewed_session_end = datetime.utcnow() + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
    if payload.extend_session:
        session_expires_at = renewed_session_end
    else:
        # Keep the current session end.  min() also caps refresh tokens issued
        # before sessions were time-limited (they had a 7-day lifetime).
        session_expires_at = min(datetime.utcfromtimestamp(token_data["exp"]), renewed_session_end)
    return _issue_tokens(token_data["sub"], session_expires_at)


@router.get("/me", response_model=UserSchema)
async def read_users_me(current_user: User = Depends(get_current_user)) -> User:
    """
    Return the profile of the currently authenticated user.

    Args:
        current_user: The authenticated ``User`` resolved from the Bearer token.

    Returns:
        The ``User`` ORM object serialised as a ``UserSchema``.
    """
    return current_user 
