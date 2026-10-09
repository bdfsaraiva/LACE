"""
Agreement-analysis annotation endpoints (agreement/disagreement-form backbone).

All routes are mounted under the prefix::

    /projects/{project_id}/chat-rooms/{room_id}/agreement-analysis

Every handler checks that the project is configured for ``"agreement_analysis"``
annotation mode and that the chat room belongs to the project before
proceeding.  The annotation-isolation rule (Pillar 1) is applied in the list
endpoint: regular annotators see only their own annotations; admins see all.

The POST endpoint is a create-or-update (upsert) keyed on (message,
annotator).  ``POST /finish`` saves every turn the annotator left undecided
as ``none`` and marks the room as completed, so annotators only need to mark
the agreement/disagreement-form turns themselves.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..auth import get_current_user
from ..dependencies import verify_project_access
from ..models import (
    User,
    AgreementAnalysisAnnotation as AAModel,
    ChatMessage,
    ChatRoom,
    Project,
)
from ..schemas import (
    AgreementAnalysisAnnotation as AASchema,
    AgreementAnalysisAnnotationCreate,
    AgreementAnalysisFinishResult,
)
from .. import crud

router = APIRouter(
    prefix="/projects/{project_id}/chat-rooms/{room_id}/agreement-analysis",
    tags=["agreement analysis"]
)


def _serialize(annotation: AAModel, annotator_username: str) -> AASchema:
    """Convert an agreement-analysis ORM row to its Pydantic response shape."""
    return AASchema(
        id=annotation.id,
        message_id=annotation.message_id,
        annotator_id=annotation.annotator_id,
        annotator_username=annotator_username,
        project_id=annotation.project_id,
        form=annotation.form,
        marker_check=annotation.marker_check,
        marker_span=annotation.marker_span,
        borderline=bool(annotation.borderline),
        multiform=bool(annotation.multiform),
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


def _get_room_in_agreement_project(db: Session, project_id: int, room_id: int) -> ChatRoom:
    """
    Return the chat room after checking the project mode and that the room
    belongs to the project.

    Raises:
        HTTPException: 404 if the project or room is not found (or the room is
            in another project); 400 if the project is not in agreement-analysis
            mode.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.annotation_type != "agreement_analysis":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This project is not configured for agreement-analysis annotation"
        )
    chat_room = db.query(ChatRoom).filter(
        ChatRoom.id == room_id,
        ChatRoom.project_id == project_id,
    ).first()
    if not chat_room:
        raise HTTPException(status_code=404, detail="Chat room not found in this project")
    return chat_room


@router.get("/", response_model=List[AASchema])
def list_agreement_analysis(
    project_id: int,
    room_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(verify_project_access),
) -> List[AASchema]:
    """
    Return agreement-analysis annotations for a chat room.

    Annotators receive only their own rows; admins receive every annotator's.
    """
    _get_room_in_agreement_project(db, project_id, room_id)

    if current_user.is_admin:
        rows = crud.get_all_agreement_analysis_for_chat_room_admin(db, chat_room_id=room_id)
    else:
        rows = crud.get_agreement_analysis_for_chat_room_by_annotator(
            db, chat_room_id=room_id, annotator_id=current_user.id
        )

    return [_serialize(annotation, username) for annotation, username in rows]


@router.post("/", response_model=AASchema)
def upsert_agreement_analysis(
    project_id: int,
    room_id: int,
    payload: AgreementAnalysisAnnotationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(verify_project_access),
) -> AASchema:
    """
    Create or update the current annotator's decision for one turn.

    Raises:
        HTTPException: 404 if the project or room is not found, or the message
            is not in the room; 400 if the project is not in agreement-analysis
            mode; 422 if the marker check does not match the form's polarity.
    """
    _get_room_in_agreement_project(db, project_id, room_id)

    message = db.query(ChatMessage).filter(
        ChatMessage.id == payload.message_id,
        ChatMessage.chat_room_id == room_id,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found in this chat room")

    annotation = crud.upsert_agreement_analysis_annotation(
        db=db,
        message_id=payload.message_id,
        annotator_id=current_user.id,
        project_id=project_id,
        payload=payload,
    )
    return _serialize(annotation, current_user.username)


@router.post("/finish", response_model=AgreementAnalysisFinishResult)
def finish_agreement_analysis_room(
    project_id: int,
    room_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(verify_project_access),
) -> AgreementAnalysisFinishResult:
    """
    Finish the room for the current annotator: undecided turns are saved as
    ``none`` and the room is marked as completed.

    Raises:
        HTTPException: 409 if a marked turn still lacks its marker check or
            cited span; 404/400 as for the other endpoints.
    """
    _get_room_in_agreement_project(db, project_id, room_id)
    filled_count = crud.finish_agreement_analysis_room(
        db, chat_room_id=room_id, project_id=project_id, annotator_id=current_user.id
    )
    return AgreementAnalysisFinishResult(filled_count=filled_count, is_completed=True)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agreement_analysis(
    project_id: int,
    room_id: int,
    annotation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(verify_project_access),
) -> None:
    """
    Delete an agreement-analysis annotation (the turn becomes undecided again).

    Annotators may only delete their own rows; admins may delete any row.
    """
    _get_room_in_agreement_project(db, project_id, room_id)

    annotation = crud.get_agreement_analysis_annotation(db, annotation_id)
    if not annotation or annotation.project_id != project_id:
        raise HTTPException(status_code=404, detail="Agreement-analysis annotation not found in this project")

    message = db.query(ChatMessage).filter(
        ChatMessage.id == annotation.message_id,
        ChatMessage.chat_room_id == room_id,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="Annotation not found in this chat room")

    if annotation.annotator_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not enough permissions to delete this annotation")

    db.delete(annotation)
    db.commit()
    return None
