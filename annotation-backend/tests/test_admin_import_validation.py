import json

from sqlalchemy import event

from app import models
from conftest import (
    engine,
    create_user,
    create_project,
    create_chat_room,
    create_message,
    assign_user,
    auth_headers
)


def test_admin_update_user_conflict_and_password(client, db_session):
    admin = create_user(db_session, "admin_u6", "pass", is_admin=True)
    user1 = create_user(db_session, "user_u6a", "pass", is_admin=False)
    user2 = create_user(db_session, "user_u6b", "pass", is_admin=False)
    headers = auth_headers(client, "admin_u6", "pass")

    # Update user with existing username -> 400
    response = client.put(f"/admin/users/{user1.id}", json={"username": user2.username}, headers=headers)
    assert response.status_code == 400

    # Update user password
    response = client.put(f"/admin/users/{user1.id}", json={"password": "newpass"}, headers=headers)
    assert response.status_code == 200


def test_admin_chat_room_completion_and_status(client, db_session):
    admin = create_user(db_session, "admin_c6", "pass", is_admin=True)
    project = create_project(db_session, name="proj_c6", annotation_type="adjacency_pairs", relation_types=["rel"])
    room = create_chat_room(db_session, project.id, name="room_c6")
    headers = auth_headers(client, "admin_c6", "pass")

    response = client.get(f"/admin/chat-rooms/{room.id}/completion-summary", headers=headers)
    assert response.status_code == 200

    response = client.get(f"/admin/chat-rooms/{room.id}/adjacency-status", headers=headers)
    assert response.status_code == 200


def test_admin_import_annotations_errors(client, db_session, tmp_path):
    admin = create_user(db_session, "admin_i6", "pass", is_admin=True)
    user = create_user(db_session, "user_i6", "pass", is_admin=False)
    project = create_project(db_session, name="proj_i6")
    room = create_chat_room(db_session, project.id, name="room_i6")
    headers = auth_headers(client, "admin_i6", "pass")

    # User not found
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-annotations",
        data={"user_id": 999},
        files={"file": ("ann.csv", b"turn_id,thread_id\nT1,TH1\n", "text/csv")},
        headers=headers
    )
    assert response.status_code == 404

    # Invalid file type
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-annotations",
        data={"user_id": user.id},
        files={"file": ("ann.txt", b"x", "text/plain")},
        headers=headers
    )
    assert response.status_code == 400

    # Invalid CSV format triggers exception block
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-annotations",
        data={"user_id": user.id},
        files={"file": ("ann.csv", b"turn_id\nT1\n", "text/csv")},
        headers=headers
    )
    assert response.status_code == 400


def test_admin_import_chat_room_csv_duplicates_and_invalid(client, db_session, tmp_path):
    admin = create_user(db_session, "admin_csv6", "pass", is_admin=True)
    project = create_project(db_session, name="proj_csv6")
    headers = auth_headers(client, "admin_csv6", "pass")

    # Invalid file type
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("bad.txt", b"x", "text/plain")},
        headers=headers
    )
    assert response.status_code == 400

    # Duplicate turn_id in CSV -> skipped_count
    csv_content = "turn_id,user_id,turn_text\n1,10,hello\n1,11,world\n"
    response = client.post(
        f"/admin/projects/{project.id}/import-chat-room-csv",
        files={"file": ("dup.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=headers
    )
    assert response.status_code == 200
    assert response.json()["import_details"]["skipped_count"] >= 1


def test_admin_import_chat_room_csv_query_count_does_not_grow_with_rows(client, db_session):
    """The import must not issue database statements per CSV row.

    With a remote database every statement is a network round trip, so a
    per-row query pattern makes a few hundred turns exceed the client timeout.
    """
    create_user(db_session, "admin_csv_q", "pass", is_admin=True)
    project = create_project(db_session, name="proj_csv_q")
    headers = auth_headers(client, "admin_csv_q", "pass")

    def count_import_statements(file_name: str, row_count: int) -> int:
        """Import a generated CSV and return the number of SQL statements run."""
        rows = "".join(
            f"T{turn},{turn % 3},turn {turn},{f'T{turn - 1}' if turn > 1 else ''}\n"
            for turn in range(1, row_count + 1)
        )
        csv_content = "turn_id,user_id,turn_text,reply_to_turn\n" + rows
        statements = []

        def record_statement(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record_statement)
        try:
            response = client.post(
                f"/admin/projects/{project.id}/import-chat-room-csv",
                files={"file": (file_name, csv_content.encode("utf-8"), "text/csv")},
                headers=headers
            )
        finally:
            event.remove(engine, "before_cursor_execute", record_statement)

        assert response.status_code == 200
        assert response.json()["import_details"]["imported_count"] == row_count, response.json()
        return len(statements)

    assert count_import_statements("small.csv", 5) == count_import_statements("large.csv", 60)

    # The batched insert stores every row with its reply link.
    large_room = db_session.query(models.ChatRoom).filter_by(name="large").one()
    stored = {m.turn_id: m for m in large_room.messages}
    assert len(stored) == 60
    assert stored["T2"].reply_to_turn == "T1"
    assert stored["T1"].reply_to_turn is None
    assert stored["T60"].created_at is not None


def test_admin_batch_import_validation_errors(client, db_session, tmp_path):
    admin = create_user(db_session, "admin_b6", "pass", is_admin=True)
    project = create_project(db_session, name="proj_b6")
    room = create_chat_room(db_session, project.id, name="room_b6")
    headers = auth_headers(client, "admin_b6", "pass")

    # Invalid JSON
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-batch-annotations",
        files={"file": ("bad.json", b"{bad}", "application/json")},
        headers=headers
    )
    assert response.status_code == 400

    # Invalid schema
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-batch-annotations",
        files={"file": ("bad.json", json.dumps({"foo": "bar"}).encode("utf-8"), "application/json")},
        headers=headers
    )
    assert response.status_code == 400

    # Chat room ID mismatch
    payload = {
        "batch_metadata": {"project_id": project.id, "chat_room_id": 999, "import_timestamp": "2026-03-13T00:00:00"},
        "annotators": []
    }
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-batch-annotations",
        files={"file": ("mismatch.json", json.dumps(payload).encode("utf-8"), "application/json")},
        headers=headers
    )
    assert response.status_code == 400


def test_admin_export_completion_status_variants(client, db_session):
    admin = create_user(db_session, "admin_ex6", "pass", is_admin=True)
    user1 = create_user(db_session, "user_ex6a", "pass", is_admin=False)
    user2 = create_user(db_session, "user_ex6b", "pass", is_admin=False)
    user3 = create_user(db_session, "user_ex6c", "pass", is_admin=False)
    project = create_project(db_session, name="proj_ex6")
    room = create_chat_room(db_session, project.id, name="room_ex6")
    msg1 = create_message(db_session, room.id, turn_id="T1", user_id="u1", text="hello")
    msg2 = create_message(db_session, room.id, turn_id="T2", user_id="u2", text="hi")
    assign_user(db_session, user1.id, project.id)
    assign_user(db_session, user2.id, project.id)
    assign_user(db_session, user3.id, project.id)
    headers = auth_headers(client, "admin_ex6", "pass")

    # Insufficient (no annotations)
    response = client.get(f"/admin/chat-rooms/{room.id}/export", headers=headers)
    assert response.status_code == 200

    # Partial (2 completed out of 3)
    from app import models
    from datetime import datetime
    db_session.add(models.Annotation(message_id=msg1.id, annotator_id=user1.id, project_id=project.id, thread_id="A"))
    db_session.add(models.Annotation(message_id=msg2.id, annotator_id=user1.id, project_id=project.id, thread_id="B"))
    db_session.add(models.Annotation(message_id=msg1.id, annotator_id=user2.id, project_id=project.id, thread_id="A"))
    db_session.add(models.Annotation(message_id=msg2.id, annotator_id=user2.id, project_id=project.id, thread_id="B"))
    db_session.commit()

    response = client.get(f"/admin/chat-rooms/{room.id}/export", headers=headers)
    assert response.status_code == 200

    # Project ID mismatch
    payload = {
        "batch_metadata": {"project_id": 999, "chat_room_id": room.id, "import_timestamp": "2026-03-13T00:00:00"},
        "annotators": []
    }
    response = client.post(
        f"/admin/chat-rooms/{room.id}/import-batch-annotations",
        files={"file": ("mismatch.json", json.dumps(payload).encode("utf-8"), "application/json")},
        headers=headers
    )
    assert response.status_code == 400
