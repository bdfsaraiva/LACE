"""Chat-room CSV import: no room on failure, unique names, batch endpoints."""
import pytest
from sqlalchemy.exc import IntegrityError

from app import models
from app.config import get_settings
from tests.conftest import auth_headers, create_chat_room, create_project, create_user

VALID = b"turn_id,user_id,turn_text,reply_to_turn\nT1,1,hello,\nT2,2,hi,T1\n"


def csv_file(name, content=VALID):
    return ("files", (name, content, "text/csv"))


@pytest.fixture
def admin_ctx(client, db_session):
    create_user(db_session, "admin_bi", "pass", is_admin=True)
    project = create_project(db_session, name="proj_bi")
    return project, auth_headers(client, "admin_bi", "pass")


def room_names(db_session, project_id):
    db_session.expire_all()
    return sorted(r.name for r in db_session.query(models.ChatRoom).filter_by(project_id=project_id))


# ── single-file endpoint ──────────────────────────────────────────────────────

def test_single_import_invalid_csv_creates_no_room(client, db_session, admin_ctx):
    project, headers = admin_ctx
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("broken.csv", b"turn_id,text\n1,x\n", "text/csv")},
        headers=headers,
    )
    assert response.status_code == 400
    assert room_names(db_session, project.id) == []


def test_single_import_header_only_creates_no_room(client, db_session, admin_ctx):
    project, headers = admin_ctx
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("empty.csv", b"turn_id,user_id,turn_text\n", "text/csv")},
        headers=headers,
    )
    assert response.status_code == 400
    assert room_names(db_session, project.id) == []


def test_single_import_duplicate_name_is_rejected(client, db_session, admin_ctx):
    project, headers = admin_ctx
    create_chat_room(db_session, project.id, name="sala1")
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("sala1.csv", VALID, "text/csv")},
        headers=headers,
    )
    assert response.status_code == 409
    assert room_names(db_session, project.id) == ["sala1"]


def test_same_name_allowed_in_another_project(client, db_session, admin_ctx):
    project, headers = admin_ctx
    other = create_project(db_session, name="proj_other")
    create_chat_room(db_session, other.id, name="sala1")
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("sala1.csv", VALID, "text/csv")},
        headers=headers,
    )
    assert response.status_code == 200


def test_database_rejects_duplicate_room_name(db_session):
    project = create_project(db_session, name="proj_db_unique")
    create_chat_room(db_session, project.id, name="dup")
    db_session.add(models.ChatRoom(name="dup", project_id=project.id))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_failed_message_insert_rolls_back_room(client, db_session, admin_ctx, monkeypatch):
    project, headers = admin_ctx
    from app import crud

    def boom(*args, **kwargs):
        raise RuntimeError("insert failed")

    monkeypatch.setattr(crud, "create_chat_messages", boom)
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("sala_x.csv", VALID, "text/csv")},
        headers=headers,
    )
    assert response.status_code == 400
    assert room_names(db_session, project.id) == []


# ── batch endpoints ───────────────────────────────────────────────────────────

def test_batch_import_creates_one_room_per_file(client, db_session, admin_ctx):
    project, headers = admin_ctx
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[csv_file("a.csv"), csv_file("b.csv"), csv_file("c.csv")],
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert (body["total_files"], body["succeeded"], body["failed"]) == (3, 3, 0)
    assert all(r["status"] == "created" for r in body["results"])
    assert body["results"][0]["import_details"]["imported_count"] == 2
    assert room_names(db_session, project.id) == ["a", "b", "c"]


def test_batch_import_bad_file_does_not_block_others(client, db_session, admin_ctx):
    project, headers = admin_ctx
    create_chat_room(db_session, project.id, name="exists")
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[
            csv_file("ok1.csv"),
            csv_file("broken.csv", b"turn_id,text\n1,x\n"),
            csv_file("exists.csv"),
            csv_file("notes.txt"),
            csv_file("ok2.csv"),
        ],
        headers=headers,
    )
    assert response.status_code == 200
    by_file = {r["filename"]: r for r in response.json()["results"]}
    assert by_file["ok1.csv"]["status"] == "created"
    assert by_file["ok2.csv"]["status"] == "created"
    assert by_file["broken.csv"]["status"] == "failed"
    assert "already exists" in by_file["exists.csv"]["error"]
    assert by_file["notes.txt"]["status"] == "failed"
    assert room_names(db_session, project.id) == ["exists", "ok1", "ok2"]


def test_batch_import_duplicate_names_within_batch(client, db_session, admin_ctx):
    project, headers = admin_ctx
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[csv_file("same.csv"), csv_file("same.csv")],
        headers=headers,
    )
    results = response.json()["results"]
    assert [r["status"] for r in results] == ["created", "failed"]
    assert "batch" in results[1]["error"]
    assert room_names(db_session, project.id) == ["same"]


def test_batch_preview_writes_nothing_and_flags_conflicts(client, db_session, admin_ctx):
    project, headers = admin_ctx
    create_chat_room(db_session, project.id, name="exists")
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv/preview",
        files=[csv_file("new.csv"), csv_file("exists.csv"), csv_file("new.csv")],
        headers=headers,
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["status"] == "ok" and results[0]["total_rows"] == 2
    assert results[1]["status"] == "failed" and "already exists" in results[1]["error"]
    assert results[2]["status"] == "failed" and "batch" in results[2]["error"]
    assert room_names(db_session, project.id) == ["exists"]


def test_batch_rejects_too_many_files(client, db_session, admin_ctx, monkeypatch):
    project, headers = admin_ctx
    monkeypatch.setattr(get_settings(), "MAX_BATCH_FILES", 2)
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[csv_file("a.csv"), csv_file("b.csv"), csv_file("c.csv")],
        headers=headers,
    )
    assert response.status_code == 400
    assert room_names(db_session, project.id) == []


def test_batch_rejects_oversized_total(client, db_session, admin_ctx, monkeypatch):
    project, headers = admin_ctx
    monkeypatch.setattr(get_settings(), "MAX_BATCH_UPLOAD_MB", 1)
    big = b"turn_id,user_id,turn_text\n" + b"".join(
        f"T{i},1,{'x' * 100}\n".encode() for i in range(6000)
    )  # ~0.6 MB each, ~1.2 MB together
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[csv_file("a.csv", big), csv_file("b.csv", big)],
        headers=headers,
    )
    assert response.status_code == 413
    assert room_names(db_session, project.id) == []


def test_batch_requires_admin_and_existing_project(client, db_session, admin_ctx):
    project, headers = admin_ctx
    response = client.post(
        "/admin/projects/99999/import-chat-rooms-csv", files=[csv_file("a.csv")], headers=headers
    )
    assert response.status_code == 404

    create_user(db_session, "annot_bi", "pass")
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-rooms-csv",
        files=[csv_file("a.csv")],
        headers=auth_headers(client, "annot_bi", "pass"),
    )
    assert response.status_code == 403


def test_import_limits_endpoint(client, admin_ctx):
    _, headers = admin_ctx
    response = client.get("/admin/import-limits", headers=headers)
    assert response.status_code == 200
    settings = get_settings()
    assert response.json() == {
        "max_file_mb": settings.MAX_UPLOAD_MB,
        "max_rows": settings.MAX_IMPORT_ROWS,
        "max_batch_files": settings.MAX_BATCH_FILES,
        "max_batch_mb": settings.MAX_BATCH_UPLOAD_MB,
    }
