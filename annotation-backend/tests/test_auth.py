from jose import jwt

from app.auth import create_access_token, create_refresh_token, verify_password, get_password_hash
from app.config import get_settings
from conftest import create_user, create_project, assign_user


def test_password_hashing_roundtrip():
    hashed = get_password_hash("secret")
    assert verify_password("secret", hashed)
    assert not verify_password("wrong", hashed)


def test_token_creation():
    settings = get_settings()
    access = create_access_token({"sub": "user1"})
    refresh = create_refresh_token({"sub": "user1"})
    assert isinstance(access, str) and isinstance(refresh, str)
    assert access != refresh
    assert jwt.decode(access, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])["type"] == "access"
    assert jwt.decode(refresh, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])["type"] == "refresh"


def test_login_refresh_me(client, db_session):
    create_user(db_session, "user1", "pass")

    # Login
    response = client.post(
        "/auth/token",
        data={"username": "user1", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert response.status_code == 200
    tokens = response.json()
    assert "access_token" in tokens and "refresh_token" in tokens

    # Me
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert response.status_code == 200
    assert response.json()["username"] == "user1"

    # Refresh
    response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 200
    refreshed = response.json()
    assert "access_token" in refreshed and "refresh_token" in refreshed


def test_login_invalid_password(client, db_session):
    create_user(db_session, "user2", "pass")
    response = client.post(
        "/auth/token",
        data={"username": "user2", "password": "wrong"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert response.status_code == 401


def test_self_registration_is_not_available(client, db_session):
    # Regression: an unauthenticated POST /auth/register used to accept
    # "is_admin": true and create an admin account.
    response = client.post(
        "/auth/register",
        json={"username": "intruder", "password": "pass1234", "is_admin": True}
    )
    assert response.status_code == 404
    response = client.post(
        "/auth/token",
        data={"username": "intruder", "password": "pass1234"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert response.status_code == 401


def test_refresh_token_cannot_authenticate_api_calls(client, db_session):
    # Regression: the 7-day refresh token used to be accepted as an access token.
    # The copy of get_current_user in app.dependencies is covered by
    # test_dependencies_more.py::test_get_current_user_rejects_refresh_token.
    user = create_user(db_session, "user3", "pass")
    project = create_project(db_session, name="refresh_proj")
    assign_user(db_session, user.id, project.id)
    response = client.post(
        "/auth/token",
        data={"username": "user3", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    tokens = response.json()
    access_headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    refresh_headers = {"Authorization": f"Bearer {tokens['refresh_token']}"}

    assert client.get(f"/projects/{project.id}", headers=access_headers).status_code == 200
    assert client.get(f"/projects/{project.id}", headers=refresh_headers).status_code == 401
    assert client.get("/auth/me", headers=refresh_headers).status_code == 401
