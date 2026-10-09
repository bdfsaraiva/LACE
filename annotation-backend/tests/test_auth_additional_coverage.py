import pytest
from fastapi import HTTPException
from jose import jwt

from app import auth
from app.config import get_settings
from conftest import create_user


@pytest.mark.anyio
async def test_get_current_user_missing_user(db_session):
    token = auth.create_access_token({"sub": "ghost_user"})
    with pytest.raises(HTTPException) as exc:
        await auth.get_current_user(token=token, db=db_session)
    assert exc.value.status_code == 401


@pytest.mark.anyio
async def test_get_current_user_rejects_refresh_token(db_session):
    create_user(db_session, "refresh_user", "pass")
    token = auth.create_refresh_token({"sub": "refresh_user"})
    with pytest.raises(HTTPException) as exc:
        await auth.get_current_user(token=token, db=db_session)
    assert exc.value.status_code == 401


@pytest.mark.anyio
async def test_get_current_user_accepts_legacy_access_token_without_type(db_session):
    # Access tokens issued before the "type" claim was added must keep working.
    settings = get_settings()
    create_user(db_session, "legacy_user", "pass")
    token = jwt.encode({"sub": "legacy_user"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    user = await auth.get_current_user(token=token, db=db_session)
    assert user.username == "legacy_user"


@pytest.mark.anyio
async def test_refresh_access_token_invalid_cases(db_session):
    settings = get_settings()

    bad_type = jwt.encode(
        {"sub": "ghost_user", "type": "access"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    with pytest.raises(HTTPException):
        await auth.refresh_access_token(refresh_token=bad_type, db=db_session)

    missing_sub = jwt.encode(
        {"type": "refresh"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    with pytest.raises(HTTPException):
        await auth.refresh_access_token(refresh_token=missing_sub, db=db_session)

    with pytest.raises(HTTPException):
        await auth.refresh_access_token(refresh_token="not-a-token", db=db_session)
