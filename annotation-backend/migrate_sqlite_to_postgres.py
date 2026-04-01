"""
Migrate data from a local SQLite database to PostgreSQL.

Usage:
    python migrate_sqlite_to_postgres.py \
        --sqlite ./data/app.db \
        --postgres postgresql+psycopg2://lace:lace@localhost:5432/lacedb
"""
import argparse
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.models import (
    Base, User, Project, ProjectAssignment, ChatRoom, ChatMessage,
    Annotation, AdjacencyPair, MessageReadStatus, ChatRoomCompletion,
)

# Tables in dependency order (parents before children)
MODELS = [
    User,
    Project,
    ProjectAssignment,
    ChatRoom,
    ChatMessage,
    Annotation,
    AdjacencyPair,
    MessageReadStatus,
    ChatRoomCompletion,
]


def migrate(sqlite_url: str, postgres_url: str) -> None:
    src = create_engine(sqlite_url)
    dst = create_engine(postgres_url)

    # Create all tables on the target
    Base.metadata.create_all(dst)

    with Session(src) as src_session, Session(dst) as dst_session:
        for model in MODELS:
            table = model.__tablename__
            rows = src_session.query(model).all()
            if not rows:
                print(f"  {table}: 0 rows, skipping")
                continue

            # Detach objects from the source session so we can re-add them
            src_session.expunge_all()

            # Disable autoincrement sequence check by resetting PK sequence after insert
            dst_session.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER ALL"))
            for row in rows:
                dst_session.merge(row)
            dst_session.flush()

            # Reset the PostgreSQL sequence to max(id) so future inserts don't conflict
            dst_session.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE(MAX(id), 1)) FROM {table}"
            ))
            dst_session.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER ALL"))
            dst_session.commit()
            print(f"  {table}: {len(rows)} rows migrated")

    print("Migration complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", required=True, help="SQLite URL, e.g. sqlite:///./data/app.db")
    parser.add_argument("--postgres", required=True, help="PostgreSQL URL")
    args = parser.parse_args()
    migrate(args.sqlite, args.postgres)
