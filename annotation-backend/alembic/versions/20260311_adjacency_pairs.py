"""Add adjacency pairs and project annotation config

Revision ID: 20260311_adjacency_pairs
Revises: 8cb8f2292bfe
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260311_adjacency_pairs"
down_revision = "8cb8f2292bfe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column("annotation_type", sa.String(), nullable=False, server_default="disentanglement")
        )
        batch_op.add_column(
            sa.Column("relation_types", sa.JSON(), nullable=False, server_default="[]")
        )

    op.create_table(
        "adjacency_pairs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("from_message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("annotator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("from_message_id", "to_message_id", "annotator_id", name="uix_adjacency_pair"),
    )
    op.create_index("ix_adjacency_pairs_from", "adjacency_pairs", ["from_message_id"])
    op.create_index("ix_adjacency_pairs_to", "adjacency_pairs", ["to_message_id"])
    op.create_index("ix_adjacency_pairs_project", "adjacency_pairs", ["project_id"])

    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("annotation_type", server_default=None)
        batch_op.alter_column("relation_types", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_adjacency_pairs_project", table_name="adjacency_pairs")
    op.drop_index("ix_adjacency_pairs_to", table_name="adjacency_pairs")
    op.drop_index("ix_adjacency_pairs_from", table_name="adjacency_pairs")
    op.drop_table("adjacency_pairs")

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("relation_types")
        batch_op.drop_column("annotation_type")
