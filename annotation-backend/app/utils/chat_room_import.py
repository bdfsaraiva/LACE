"""
Chat-room CSV import shared by the single-file and the batch endpoints.

An import runs in two phases so that a failing file never leaves a room behind:

1. ``parse_chat_room_csv`` validates and parses the whole file in memory and
   touches no database state.  Any problem with the file is raised here.
2. ``create_room_with_messages`` adds the room and its messages in a single
   transaction and commits once.  If anything fails the transaction is rolled
   back, so the room is never visible without its messages.

Room names come from the CSV filename and are unique within a project.
"""
import os
import tempfile
from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from .csv_utils import import_chat_messages, validate_csv_format
from .upload_limits import enforce_max_rows, enforce_max_upload_size


class RoomImportError(Exception):
    """A file that cannot be imported; ``status_code`` maps it to HTTP."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class ParsedRoomCSV:
    """A fully validated chat-room CSV, ready to be written."""

    room_name: str
    messages: List[schemas.ChatMessageCreate]
    total_messages: int
    skipped_count: int = 0
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


def room_name_from_filename(filename: Optional[str]) -> str:
    """
    Return the room name for an uploaded CSV, or raise ``RoomImportError``.

    The name is the file's basename without its ``.csv`` extension, stripped
    of surrounding whitespace.
    """
    if not filename or not filename.lower().endswith(".csv"):
        raise RoomImportError("File must be a CSV and have a filename")
    name = os.path.splitext(os.path.basename(filename))[0].strip()
    if not name:
        raise RoomImportError("The CSV filename does not give a room name")
    return name


def room_name_exists(db: Session, project_id: int, name: str) -> bool:
    """Return whether ``project_id`` already has a chat room called ``name``."""
    return (
        db.query(models.ChatRoom.id)
        .filter(models.ChatRoom.project_id == project_id, models.ChatRoom.name == name)
        .first()
        is not None
    )


def existing_room_names(db: Session, project_id: int) -> set[str]:
    """Return the names of every chat room in ``project_id`` in one query."""
    rows = db.query(models.ChatRoom.name).filter(models.ChatRoom.project_id == project_id).all()
    return {row[0] for row in rows}


def parse_chat_room_csv(
    filename: Optional[str], contents: bytes, max_upload_mb: int, max_rows: int
) -> ParsedRoomCSV:
    """
    Validate and parse one chat-room CSV without writing to the database.

    Duplicate ``turn_id`` rows are skipped with a warning, and a
    ``reply_to_turn`` pointing at a turn missing from the file is cleared with
    a warning, as the single-file import always did.

    Raises:
        RoomImportError: If the file is not a CSV, is too large or too long,
            cannot be parsed, or contains no importable turn.
    """
    room_name = room_name_from_filename(filename)
    try:
        enforce_max_upload_size(len(contents), max_upload_mb, "CSV upload")
    except Exception as e:  # HTTPException from the shared guard
        raise RoomImportError(getattr(e, "detail", str(e)), status_code=413)

    # The CSV helpers read from a path.  A unique temporary file keeps two
    # uploads with the same name (or two requests at once) apart.
    fd, temp_path = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contents)
        try:
            validate_csv_format(temp_path)
            rows = import_chat_messages(temp_path)
        except Exception as e:
            raise RoomImportError(f"Error processing CSV file: {e}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    try:
        enforce_max_rows(len(rows), max_rows, "CSV messages")
    except Exception as e:
        raise RoomImportError(getattr(e, "detail", str(e)))

    parsed = ParsedRoomCSV(room_name=room_name, messages=[], total_messages=len(rows))
    existing_turns = {row["turn_id"] for row in rows if row.get("turn_id")}
    seen_turns: set[str] = set()

    for row in rows:
        try:
            message = schemas.ChatMessageCreate(
                turn_id=row["turn_id"],
                user_id=row["user_id"],
                turn_text=row["turn_text"],
                reply_to_turn=row.get("reply_to_turn"),
            )
        except Exception as e:
            parsed.errors.append(f"Error importing message {row.get('turn_id', 'unknown')}: {e}")
            parsed.skipped_count += 1
            continue

        if message.turn_id in seen_turns:
            parsed.skipped_count += 1
            parsed.warnings.append(f"Message with turn_id {message.turn_id} already exists")
            continue

        if message.reply_to_turn and message.reply_to_turn not in existing_turns:
            parsed.warnings.append(
                f"Message {message.turn_id} references missing reply_to_turn "
                f"{message.reply_to_turn}; cleared."
            )
            message.reply_to_turn = None

        parsed.messages.append(message)
        seen_turns.add(message.turn_id)

    if not parsed.messages:
        raise RoomImportError("The CSV file has no turns to import")
    return parsed


def create_room_with_messages(
    db: Session, project_id: int, parsed: ParsedRoomCSV
) -> models.ChatRoom:
    """
    Create the chat room and all its messages in one transaction.

    Nothing is committed unless every statement succeeds, so a failed import
    leaves no room behind.

    Raises:
        RoomImportError: 409 if the project already has a room with this name
            (also when another request created it in the meantime), 400 for
            any other database error.
    """
    if room_name_exists(db, project_id, parsed.room_name):
        raise RoomImportError(
            f"A chat room named '{parsed.room_name}' already exists in this project",
            status_code=409,
        )
    try:
        room = models.ChatRoom(name=parsed.room_name, project_id=project_id)
        db.add(room)
        db.flush()  # assigns room.id inside the open transaction
        crud.create_chat_messages(db, messages=parsed.messages, chat_room_id=room.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise RoomImportError(
            f"A chat room named '{parsed.room_name}' already exists in this project",
            status_code=409,
        )
    except Exception as e:
        db.rollback()
        raise RoomImportError(f"Error saving chat room: {e}")
    db.refresh(room)
    return room


def import_details(parsed: ParsedRoomCSV) -> schemas.CSVImportResponse:
    """Build the import statistics returned to the client."""
    return schemas.CSVImportResponse(
        total_messages=parsed.total_messages,
        imported_count=len(parsed.messages),
        skipped_count=parsed.skipped_count,
        errors=parsed.errors,
        warnings=parsed.warnings,
    )
