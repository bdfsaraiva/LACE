"""Tests for the single-container entry point (API under /api plus the SPA)."""
from pathlib import Path
from typing import Iterator, List

import pytest
from fastapi.testclient import TestClient

from app import dependencies as dependencies_module
from app.database import get_db as database_get_db
from app.main import app as api_app
from app.site import create_site
from conftest import create_user, override_get_db

INDEX_HTML = "<!doctype html><div id='root'></div>"


@pytest.fixture
def frontend_dir(tmp_path: Path) -> Path:
    """A minimal SPA build: ``index.html`` plus one hashed asset."""
    (tmp_path / "index.html").write_text(INDEX_HTML)
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "main-abc123.js").write_text("console.log('spa');")
    return tmp_path


@pytest.fixture
def startup_calls(monkeypatch: pytest.MonkeyPatch) -> List[str]:
    """Replace the API startup hooks with a recorder (no admin seeding)."""
    calls: List[str] = []
    monkeypatch.setattr(api_app.router, "on_startup", [lambda: calls.append("api startup")])
    return calls


@pytest.fixture
def site_client(db_session, frontend_dir: Path, startup_calls: List[str]) -> Iterator[TestClient]:
    """Client for the combined app, with the API bound to the test database."""
    api_app.dependency_overrides[database_get_db] = override_get_db
    api_app.dependency_overrides[dependencies_module.get_db] = override_get_db
    with TestClient(create_site(frontend_dir)) as client:
        yield client
    api_app.dependency_overrides.clear()


def test_root_serves_spa_index(site_client: TestClient) -> None:
    response = site_client.get("/")
    assert response.status_code == 200
    assert response.text == INDEX_HTML


def test_client_side_route_falls_back_to_index(site_client: TestClient) -> None:
    # A page reload on a React Router route must not hit the API or 404.
    response = site_client.get("/projects/3/rooms/1")
    assert response.status_code == 200
    assert response.text == INDEX_HTML


def test_static_asset_is_served(site_client: TestClient) -> None:
    response = site_client.get("/assets/main-abc123.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]


def test_api_is_mounted_under_prefix(site_client: TestClient) -> None:
    response = site_client.get("/api/")
    assert response.status_code == 200
    assert response.json()["name"] == "Annotation Tool Backend"


def test_unknown_api_route_returns_api_404(site_client: TestClient) -> None:
    response = site_client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_swagger_ui_loads_prefixed_openapi(site_client: TestClient) -> None:
    docs = site_client.get("/api/docs")
    assert docs.status_code == 200
    assert "/api/openapi.json" in docs.text
    assert site_client.get("/api/openapi.json").status_code == 200


def test_login_through_prefix(site_client: TestClient, db_session) -> None:
    create_user(db_session, "site_user", "pass")
    response = site_client.post(
        "/api/auth/token",
        data={"username": "site_user", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = site_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "site_user"


def test_api_startup_hook_runs(site_client: TestClient, startup_calls: List[str]) -> None:
    assert startup_calls == ["api startup"]
