"""
Session lifetime: SESSION_EXPIRE_MINUTES is absolute.  A routine refresh keeps
the session end, only ``extend_session=true`` ("Renew session") moves it, and
no token outlives the session.
"""
import time
from datetime import timedelta

from jose import jwt

from app.auth import create_refresh_token
from app.config import get_settings
from conftest import create_user


def _claims(token):
    settings = get_settings()
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def _assert_about(actual, expected):
    """Allow a couple of seconds for the time spent running the request."""
    assert expected - 2 <= actual <= expected + 2


def test_login_starts_session_of_configured_length(client, db_session):
    session_seconds = get_settings().SESSION_EXPIRE_MINUTES * 60
    create_user(db_session, "session_user", "pass")

    response = client.post(
        "/auth/token",
        data={"username": "session_user", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    tokens = response.json()

    _assert_about(tokens["session_expires_at"], int(time.time()) + session_seconds)
    assert _claims(tokens["refresh_token"])["exp"] == tokens["session_expires_at"]
    assert _claims(tokens["access_token"])["exp"] <= tokens["session_expires_at"]


def test_routine_refresh_keeps_session_end(client, db_session):
    create_user(db_session, "session_user", "pass")
    # A session with 5 minutes left.
    short_session = create_refresh_token({"sub": "session_user"}, expires_delta=timedelta(minutes=5))
    session_end = _claims(short_session)["exp"]

    refreshed = client.post("/auth/refresh", json={"refresh_token": short_session}).json()

    assert refreshed["session_expires_at"] == session_end
    assert _claims(refreshed["refresh_token"])["exp"] == session_end
    # The access token is cut short so it cannot outlive the session.
    assert _claims(refreshed["access_token"])["exp"] <= session_end
    assert refreshed["expires_in"] <= 5 * 60


def test_renew_session_extends_by_configured_length(client, db_session):
    session_seconds = get_settings().SESSION_EXPIRE_MINUTES * 60
    create_user(db_session, "session_user", "pass")
    short_session = create_refresh_token({"sub": "session_user"}, expires_delta=timedelta(minutes=2))

    renewed = client.post(
        "/auth/refresh",
        json={"refresh_token": short_session, "extend_session": True}
    ).json()

    _assert_about(renewed["session_expires_at"], int(time.time()) + session_seconds)
    assert _claims(renewed["refresh_token"])["exp"] == renewed["session_expires_at"]


def test_refresh_caps_legacy_long_lived_refresh_token(client, db_session):
    # Refresh tokens issued before sessions were time-limited lived 7 days.
    session_seconds = get_settings().SESSION_EXPIRE_MINUTES * 60
    create_user(db_session, "session_user", "pass")
    legacy = create_refresh_token({"sub": "session_user"}, expires_delta=timedelta(days=7))

    refreshed = client.post("/auth/refresh", json={"refresh_token": legacy}).json()

    assert refreshed["session_expires_at"] <= int(time.time()) + session_seconds + 2


def test_ended_session_cannot_be_refreshed_or_renewed(client, db_session):
    create_user(db_session, "session_user", "pass")
    ended = create_refresh_token({"sub": "session_user"}, expires_delta=timedelta(seconds=-1))

    for extend_session in (False, True):
        response = client.post(
            "/auth/refresh",
            json={"refresh_token": ended, "extend_session": extend_session}
        )
        assert response.status_code == 401
