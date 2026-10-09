"""
Agreement-analysis mode (agreement/disagreement-form backbone): annotation
CRUD, "finish room", IAA and exports.
"""
import io
import zipfile

import pytest

from app import crud, models
from conftest import (
    assign_user,
    auth_headers,
    create_agreement_annotation,
    create_chat_room,
    create_message,
    create_project,
    create_user,
)


def _setup(db_session, message_count=3):
    """Agreement-analysis project with two assigned annotators, an admin and one room."""
    admin = create_user(db_session, "aa_admin", "pass", is_admin=True)
    alice = create_user(db_session, "alice", "pass")
    bob = create_user(db_session, "bob", "pass")
    project = create_project(db_session, name="aa_project", annotation_type="agreement_analysis")
    assign_user(db_session, alice.id, project.id)
    assign_user(db_session, bob.id, project.id)
    room = create_chat_room(db_session, project.id, name="aa_room")
    messages = [create_message(db_session, room.id, i, text=f"turn {i}") for i in range(1, message_count + 1)]
    return admin, alice, bob, project, room, messages


def _url(project, room, suffix=""):
    return f"/projects/{project.id}/chat-rooms/{room.id}/agreement-analysis/{suffix}"


def test_upsert_creates_and_updates_the_decision(client, db_session):
    _, alice, _, project, room, messages = _setup(db_session)
    headers = auth_headers(client, "alice", "pass")

    created = client.post(_url(project, room), json={
        "message_id": messages[0].id, "form": "agreement-form",
        "marker_check": "agreement_verb", "marker_span": "  I agree  ",
    }, headers=headers)
    assert created.status_code == 200
    assert created.json()["marker_span"] == "I agree"

    updated = client.post(_url(project, room), json={
        "message_id": messages[0].id, "form": "disagreement-form",
        "marker_check": "falsity_formula", "marker_span": "that's not true", "borderline": True,
    }, headers=headers)
    assert updated.status_code == 200
    assert updated.json()["id"] == created.json()["id"]
    assert updated.json()["form"] == "disagreement-form"
    assert db_session.query(models.AgreementAnalysisAnnotation).count() == 1


def test_none_decision_clears_marker_fields(client, db_session):
    _, _, _, project, room, messages = _setup(db_session)
    headers = auth_headers(client, "alice", "pass")
    client.post(_url(project, room), json={
        "message_id": messages[0].id, "form": "agreement-form", "marker_check": "correctness_formula",
        "marker_span": "you're right", "borderline": True, "multiform": True,
    }, headers=headers)

    response = client.post(_url(project, room), json={
        "message_id": messages[0].id, "form": "none", "marker_check": "correctness_formula",
        "marker_span": "you're right", "borderline": True, "multiform": True,
    }, headers=headers)

    body = response.json()
    assert (body["form"], body["marker_check"], body["marker_span"], body["borderline"], body["multiform"]) == (
        "none", None, "", False, False
    )


@pytest.mark.parametrize("payload", [
    {"form": "agreement-form", "marker_check": "falsity_formula"},
    {"form": "disagreement-form", "marker_check": "agreement_verb"},
    {"form": "agreement-form", "marker_check": "not_a_check"},
    {"form": "maybe"},
    {"form": "agreement-form", "marker_span": "x" * 301},
])
def test_invalid_payloads_are_rejected(client, db_session, payload):
    _, _, _, project, room, messages = _setup(db_session)
    headers = auth_headers(client, "alice", "pass")

    response = client.post(_url(project, room), json={"message_id": messages[0].id, **payload}, headers=headers)

    assert response.status_code == 422
    assert db_session.query(models.AgreementAnalysisAnnotation).count() == 0


def test_annotators_see_only_their_own_rows_and_admins_see_all(client, db_session):
    _, alice, bob, project, room, messages = _setup(db_session)
    create_agreement_annotation(db_session, messages[0].id, alice.id, project.id)
    create_agreement_annotation(db_session, messages[0].id, bob.id, project.id)

    alice_rows = client.get(_url(project, room), headers=auth_headers(client, "alice", "pass")).json()
    admin_rows = client.get(_url(project, room), headers=auth_headers(client, "aa_admin", "pass")).json()

    assert [row["annotator_username"] for row in alice_rows] == ["alice"]
    assert sorted(row["annotator_username"] for row in admin_rows) == ["alice", "bob"]


def test_endpoints_require_agreement_analysis_mode(client, db_session):
    _, alice, _, _, _, _ = _setup(db_session)
    qa_project = create_project(db_session, name="qa_project", annotation_type="question_analysis")
    assign_user(db_session, alice.id, qa_project.id)
    qa_room = create_chat_room(db_session, qa_project.id, name="qa_room")
    qa_message = create_message(db_session, qa_room.id, 1)
    headers = auth_headers(client, "alice", "pass")

    post = client.post(_url(qa_project, qa_room), json={"message_id": qa_message.id, "form": "none"}, headers=headers)
    finish = client.post(_url(qa_project, qa_room, "finish"), headers=headers)
    delete = client.delete(_url(qa_project, qa_room, "1"), headers=headers)

    assert (post.status_code, finish.status_code, delete.status_code) == (400, 400, 400)


def test_cannot_write_into_a_room_of_another_project(client, db_session):
    _, _, _, project, _, _ = _setup(db_session)
    other_project = create_project(db_session, name="other", annotation_type="agreement_analysis")
    other_room = create_chat_room(db_session, other_project.id, name="other_room")
    other_message = create_message(db_session, other_room.id, 1)

    response = client.post(
        f"/projects/{project.id}/chat-rooms/{other_room.id}/agreement-analysis/",
        json={"message_id": other_message.id, "form": "none"},
        headers=auth_headers(client, "alice", "pass"),
    )

    assert response.status_code == 404
    assert db_session.query(models.AgreementAnalysisAnnotation).count() == 0


def test_upsert_turns_a_lost_insert_race_into_an_update(db_session, monkeypatch):
    _, alice, _, project, _, messages = _setup(db_session)
    existing = create_agreement_annotation(db_session, messages[0].id, alice.id, project.id)
    real_lookup = crud.get_agreement_analysis_for_message_by_annotator
    lookups = []

    def lookup_missing_the_first_time(db, message_id, annotator_id):
        lookups.append(message_id)
        return None if len(lookups) == 1 else real_lookup(db, message_id, annotator_id)

    monkeypatch.setattr(crud, "get_agreement_analysis_for_message_by_annotator", lookup_missing_the_first_time)
    payload = crud.schemas.AgreementAnalysisAnnotationCreate(
        message_id=messages[0].id, form="agreement-form", marker_check="agreement_verb", marker_span="I agree"
    )

    saved = crud.upsert_agreement_analysis_annotation(db_session, messages[0].id, alice.id, project.id, payload)

    assert saved.id == existing.id
    assert saved.form == "agreement-form"
    assert db_session.query(models.AgreementAnalysisAnnotation).count() == 1


def test_finish_room_saves_undecided_turns_as_none_and_completes_the_room(client, db_session):
    _, alice, _, project, room, messages = _setup(db_session, message_count=4)
    create_agreement_annotation(
        db_session, messages[1].id, alice.id, project.id,
        form="agreement-form", marker_check="agreement_verb", marker_span="I agree",
    )

    response = client.post(_url(project, room, "finish"), headers=auth_headers(client, "alice", "pass"))

    assert response.status_code == 200
    assert response.json() == {"filled_count": 3, "is_completed": True}
    forms = {
        annotation.message_id: annotation.form
        for annotation in db_session.query(models.AgreementAnalysisAnnotation).all()
    }
    assert forms == {
        messages[0].id: "none", messages[1].id: "agreement-form", messages[2].id: "none", messages[3].id: "none"
    }
    completion = crud.get_chat_room_completion(db_session, room.id, alice.id)
    assert completion.is_completed is True


def test_finish_room_is_refused_while_a_marked_turn_is_incomplete(client, db_session):
    _, alice, _, project, room, messages = _setup(db_session)
    create_agreement_annotation(db_session, messages[1].id, alice.id, project.id, form="disagreement-form")

    response = client.post(_url(project, room, "finish"), headers=auth_headers(client, "alice", "pass"))

    assert response.status_code == 409
    assert "turn 2" in response.json()["detail"]
    assert db_session.query(models.AgreementAnalysisAnnotation).count() == 1
    assert crud.get_chat_room_completion(db_session, room.id, alice.id) is None


def test_pairwise_iaa_components_and_kappa():
    annotations_a = {
        1: ("agreement-form", "agreement_verb", False, False),
        2: ("agreement-form", "correctness_formula", True, False),
        3: ("disagreement-form", "disagreement_verb", False, True),
        4: ("none", None, False, False),
        5: ("none", None, False, False),
        6: ("agreement-form", "truth_confirmation_formula", False, False),
    }
    annotations_b = {
        1: ("agreement-form", "agreement_verb", False, False),
        2: ("agreement-form", "truth_confirmation_formula", False, False),
        3: ("disagreement-form", "disagreement_verb", False, True),
        4: ("none", None, False, False),
        5: ("agreement-form", "shared_position_formula", False, False),
        6: ("none", None, False, False),
    }

    result = crud._calculate_agreement_analysis_iaa(annotations_a, annotations_b)

    # Forms agree on turns 1-4: p_o = 4/6.  Label counts are 3/1/2 for both,
    # so p_e = (9 + 1 + 4) / 36 and κ = (24/36 − 14/36) / (1 − 14/36) = 5/11.
    assert result["form_accuracy"] == pytest.approx(400 / 6)
    assert result["form_kappa"] == pytest.approx(5 / 11)
    # Both marked: turns 1-3, all with the same form.
    assert result["marked_in_common_count"] == 3
    assert result["marker_agreement"] == pytest.approx(200 / 3)
    assert result["clarity_agreement"] == pytest.approx(200 / 3)
    assert result["multiform_agreement"] == pytest.approx(100.0)
    assert result["combined_iaa"] == pytest.approx(75.0)
    assert result["common_message_count"] == 6


def test_kappa_is_undefined_and_marker_components_absent_when_nothing_is_marked():
    annotations = {1: ("none", None, False, False), 2: ("none", None, False, False)}

    result = crud._calculate_agreement_analysis_iaa(annotations, dict(annotations))

    assert result["form_accuracy"] == pytest.approx(100.0)
    assert result["form_kappa"] is None
    assert result["marker_agreement"] is None
    assert result["clarity_agreement"] is None
    assert result["multiform_agreement"] is None
    assert result["combined_iaa"] == pytest.approx(100.0)


def test_room_iaa_counts_only_complete_turns(client, db_session):
    _, alice, bob, project, room, messages = _setup(db_session, message_count=2)
    admin_headers = auth_headers(client, "aa_admin", "pass")
    for annotator in (alice, bob):
        create_agreement_annotation(db_session, messages[0].id, annotator.id, project.id)
    create_agreement_annotation(
        db_session, messages[1].id, alice.id, project.id,
        form="agreement-form", marker_check="agreement_verb", marker_span="I agree",
    )
    incomplete = create_agreement_annotation(db_session, messages[1].id, bob.id, project.id, form="agreement-form")

    before = client.get(f"/admin/chat-rooms/{room.id}/iaa", headers=admin_headers).json()
    assert before["analysis_status"] == "NotEnoughData"
    assert [a["username"] for a in before["pending_annotators"]] == ["bob"]

    incomplete.marker_check = "correctness_formula"
    incomplete.marker_span = "you're right"
    db_session.commit()
    after = client.get(f"/admin/chat-rooms/{room.id}/iaa", headers=admin_headers).json()

    assert after["annotation_type"] == "agreement_analysis"
    assert after["analysis_status"] == "Complete"
    [pair] = after["pairwise_agreement_analysis_iaa"]
    assert pair["form_accuracy"] == pytest.approx(100.0)
    assert pair["marker_agreement"] == pytest.approx(0.0)
    assert pair["common_message_count"] == 2


def test_json_export_includes_every_decision(client, db_session):
    _, alice, _, project, room, messages = _setup(db_session, message_count=2)
    create_agreement_annotation(db_session, messages[0].id, alice.id, project.id)
    create_agreement_annotation(
        db_session, messages[1].id, alice.id, project.id,
        form="disagreement-form", marker_check="alternative_position_formula",
        marker_span="I see it differently", borderline=True,
    )

    response = client.get(
        f"/admin/chat-rooms/{room.id}/export-agreement-analysis-json",
        headers=auth_headers(client, "aa_admin", "pass"),
    )

    assert response.status_code == 200
    export = response.json()
    assert export["export_metadata"]["annotation_type"] == "agreement_analysis"
    assert export["export_metadata"]["completion_status"] == "INSUFFICIENT"
    second_turn = export["data"]["messages"][1]["annotations"][0]
    assert (second_turn["form"], second_turn["clarity"], second_turn["complete"]) == (
        "disagreement-form", "borderline", True
    )
    assert export["data"]["messages"][0]["annotations"][0]["form"] == "none"


def test_csv_export_lists_only_marked_turns_and_escapes_formulas(client, db_session):
    _, alice, bob, project, room, messages = _setup(db_session, message_count=2)
    create_agreement_annotation(db_session, messages[0].id, alice.id, project.id)
    create_agreement_annotation(
        db_session, messages[1].id, alice.id, project.id,
        form="agreement-form", marker_check="agreement_verb", marker_span="=I agree", multiform=True,
    )
    admin_headers = auth_headers(client, "aa_admin", "pass")

    single = client.get(
        f"/admin/chat-rooms/{room.id}/export-agreement-analysis?annotator_id={alice.id}", headers=admin_headers
    )
    assert single.status_code == 200
    assert single.text.splitlines() == [
        "turn_id,label,triggering_marker_check,triggering_marker_span,clarity,multi_form",
        "2,agreement-form,agreement_verb,'=I agree,clear,yes",
    ]

    archive = client.get(f"/admin/chat-rooms/{room.id}/export-agreement-analysis", headers=admin_headers)
    assert archive.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(archive.content)) as zf:
        assert sorted(zf.namelist()) == ["aa_room-alice.csv", "aa_room-bob.csv"]
        assert zf.read("aa_room-bob.csv").decode().splitlines() == [
            "turn_id,label,triggering_marker_check,triggering_marker_span,clarity,multi_form"
        ]


def test_exports_require_agreement_analysis_mode(client, db_session):
    _setup(db_session)
    qa_project = create_project(db_session, name="qa_project", annotation_type="question_analysis")
    qa_room = create_chat_room(db_session, qa_project.id, name="qa_room")
    admin_headers = auth_headers(client, "aa_admin", "pass")

    csv_export = client.get(f"/admin/chat-rooms/{qa_room.id}/export-agreement-analysis", headers=admin_headers)
    json_export = client.get(f"/admin/chat-rooms/{qa_room.id}/export-agreement-analysis-json", headers=admin_headers)

    assert (csv_export.status_code, json_export.status_code) == (400, 400)
