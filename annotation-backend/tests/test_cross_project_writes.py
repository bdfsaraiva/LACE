"""
Regression tests: an annotator assigned to project A must not be able to write
annotations or read flags onto messages of a room that belongs to project B by
putting project A's id in the URL.
"""
from app import models
from conftest import (
    assign_user,
    auth_headers,
    create_chat_room,
    create_message,
    create_project,
    create_user,
)


def _setup(db_session, annotation_type, relation_types=None):
    """Create an annotator assigned to project A and a room with two messages in project B."""
    annotator = create_user(db_session, "annotator_a", "pass")
    project_a = create_project(
        db_session, name="project_a", annotation_type=annotation_type, relation_types=relation_types
    )
    project_b = create_project(
        db_session, name="project_b", annotation_type=annotation_type, relation_types=relation_types
    )
    assign_user(db_session, annotator.id, project_a.id)
    room_a = create_chat_room(db_session, project_a.id, name="room_a")
    room_b = create_chat_room(db_session, project_b.id, name="room_b")
    message_a = create_message(db_session, room_a.id, 1)
    message_b1 = create_message(db_session, room_b.id, 1)
    message_b2 = create_message(db_session, room_b.id, 2)
    return project_a, room_a, room_b, message_a, message_b1, message_b2


def test_adjacency_pair_cannot_be_written_into_other_project_room(client, db_session):
    project_a, _, room_b, _, message_b1, message_b2 = _setup(
        db_session, "adjacency_pairs", relation_types=["answer"]
    )
    headers = auth_headers(client, "annotator_a", "pass")

    response = client.post(
        f"/projects/{project_a.id}/chat-rooms/{room_b.id}/adjacency-pairs/",
        json={"from_message_id": message_b1.id, "to_message_id": message_b2.id, "relation_type": "answer"},
        headers=headers,
    )
    assert response.status_code == 404
    assert db_session.query(models.AdjacencyPair).count() == 0


def test_question_analysis_cannot_be_written_into_other_project_room(client, db_session):
    project_a, _, room_b, _, message_b1, _ = _setup(db_session, "question_analysis")
    headers = auth_headers(client, "annotator_a", "pass")

    response = client.post(
        f"/projects/{project_a.id}/chat-rooms/{room_b.id}/question-analysis/",
        json={"message_id": message_b1.id, "is_question": True},
        headers=headers,
    )
    assert response.status_code == 404
    assert db_session.query(models.QuestionAnalysisAnnotation).count() == 0


def test_question_analysis_write_in_own_room_still_works(client, db_session):
    project_a, room_a, _, message_a, _, _ = _setup(db_session, "question_analysis")
    headers = auth_headers(client, "annotator_a", "pass")

    response = client.post(
        f"/projects/{project_a.id}/chat-rooms/{room_a.id}/question-analysis/",
        json={"message_id": message_a.id, "is_question": True},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["is_question"] is True


def test_read_status_cannot_flag_messages_of_other_rooms(client, db_session):
    project_a, room_a, _, message_a, message_b1, _ = _setup(db_session, "adjacency_pairs")
    headers = auth_headers(client, "annotator_a", "pass")
    url = f"/projects/{project_a.id}/chat-rooms/{room_a.id}/read-status"

    response = client.put(
        url,
        json={"statuses": [
            {"message_id": message_a.id, "is_read": True},
            {"message_id": message_b1.id, "is_read": True},
        ]},
        headers=headers,
    )
    assert response.status_code == 404
    assert db_session.query(models.MessageReadStatus).count() == 0

    response = client.put(
        url,
        json={"statuses": [{"message_id": message_a.id, "is_read": True}]},
        headers=headers,
    )
    assert response.status_code == 204
    assert db_session.query(models.MessageReadStatus).count() == 1
