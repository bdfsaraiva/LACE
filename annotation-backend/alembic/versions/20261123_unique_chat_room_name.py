"""Make chat room names unique within a project

Revision ID: 20261123_unique_room_name
Revises: 20261009_agreement_analysis
Create Date: 2026-11-23

Rooms that already share a name inside the same project are renamed before
the unique index is created: the oldest room (lowest id) keeps the name and
every other one becomes ``"<name> (<id>)"``.  Each rename is printed so it
shows up in the deployment log.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261123_unique_room_name"
down_revision = "20261009_agreement_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rooms = sa.table(
        "chat_rooms",
        sa.column("id", sa.Integer),
        sa.column("project_id", sa.Integer),
        sa.column("name", sa.String),
    )
    rows = conn.execute(
        sa.select(rooms.c.id, rooms.c.project_id, rooms.c.name).order_by(rooms.c.id)
    ).fetchall()

    taken: set[tuple[int, str]] = {(row.project_id, row.name) for row in rows}
    kept: set[tuple[int, str]] = set()
    for row in rows:
        key = (row.project_id, row.name)
        if key not in kept:
            kept.add(key)
            continue
        new_name = f"{row.name} ({row.id})"
        suffix = 2
        while (row.project_id, new_name) in taken:
            new_name = f"{row.name} ({row.id}-{suffix})"
            suffix += 1
        taken.add((row.project_id, new_name))
        conn.execute(sa.update(rooms).where(rooms.c.id == row.id).values(name=new_name))
        print(
            f"[20261123_unique_room_name] project {row.project_id}: renamed duplicate "
            f"chat room {row.id} '{row.name}' -> '{new_name}'"
        )

    op.create_index(
        "uix_chat_room_project_name", "chat_rooms", ["project_id", "name"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uix_chat_room_project_name", table_name="chat_rooms")
